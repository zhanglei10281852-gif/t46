const { Router } = require("express");
const { pool } = require("../db");
const router = Router();

const VALID_CATEGORIES = ['宪法', '法律', '行政法规', '地方性法规', '司法解释', '部门规章'];

router.post("/", async (req, res) => {
  const { name, law_no, issuing_authority, issue_date, effective_date, category, content, keywords, is_valid } = req.body;
  if (!name || !category) {
    return res.status(400).json({ error: "法规名称和类别为必填" });
  }
  if (!VALID_CATEGORIES.includes(category)) {
    return res.status(400).json({ error: "无效的法规类别" });
  }
  try {
    const keywordsStr = Array.isArray(keywords) ? keywords.join(",") : (keywords || "");
    const [result] = await pool.execute(
      `INSERT INTO laws (name, law_no, issuing_authority, issue_date, effective_date, category, content, keywords, is_valid)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [
        name,
        law_no || null,
        issuing_authority || null,
        issue_date || null,
        effective_date || null,
        category,
        content || null,
        keywordsStr,
        is_valid !== undefined ? is_valid : 1,
      ]
    );
    res.status(201).json({ id: result.insertId, message: "法规录入成功" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/", async (req, res) => {
  const { category, is_valid, keyword, tag, start_date, end_date, page = 1, size = 20, sort = "date" } = req.query;
  let conditions = [];
  let params = [];

  if (category) {
    conditions.push("category = ?");
    params.push(category);
  }
  if (is_valid !== undefined) {
    conditions.push("is_valid = ?");
    params.push(is_valid);
  }
  if (tag) {
    conditions.push("keywords LIKE ?");
    params.push(`%${tag}%`);
  }
  if (start_date) {
    conditions.push("issue_date >= ?");
    params.push(start_date);
  }
  if (end_date) {
    conditions.push("issue_date <= ?");
    params.push(end_date);
  }

  let selectSql = "SELECT *";
  let fromWhere = "FROM laws";
  let orderBy = "ORDER BY created_at DESC";

  if (keyword) {
    selectSql = `SELECT *,
      (CASE WHEN name LIKE ? THEN 3 ELSE 0 END
       + CASE WHEN keywords LIKE ? THEN 2 ELSE 0 END
       + CASE WHEN content LIKE ? THEN 1 ELSE 0 END) AS relevance`;
    params.unshift(`%${keyword}%`);
    params.splice(1, 0, `%${keyword}%`);
    params.splice(2, 0, `%${keyword}%`);
    conditions.push("(name LIKE ? OR keywords LIKE ? OR content LIKE ?)");
    params.push(`%${keyword}%`);
    params.push(`%${keyword}%`);
    params.push(`%${keyword}%`);
    orderBy = "ORDER BY relevance DESC, created_at DESC";
  }

  const where = conditions.length ? " WHERE " + conditions.join(" AND ") : "";

  const [[{ total }]] = await pool.execute(
    `SELECT COUNT(*) as total FROM laws${where}`,
    params.slice(keyword ? 3 : 0)
  );

  const limit = parseInt(size);
  const offset = (parseInt(page) - 1) * limit;

  const [data] = await pool.query(
    `${selectSql} ${fromWhere}${where} ${orderBy} LIMIT ${limit} OFFSET ${offset}`,
    params
  );

  data.forEach(item => {
    if (item.keywords) {
      item.keywords = item.keywords.split(",").filter(k => k.trim());
    } else {
      item.keywords = [];
    }
  });

  res.json({ total, page: parseInt(page), size: limit, data });
});

router.get("/search", async (req, res) => {
  const { q, category, start_date, end_date, page = 1, size = 20 } = req.query;
  if (!q) {
    return res.status(400).json({ error: "搜索关键词不能为空" });
  }

  let conditions = [];
  let params = [];

  if (category) {
    conditions.push("category = ?");
    params.push(category);
  }
  if (start_date) {
    conditions.push("issue_date >= ?");
    params.push(start_date);
  }
  if (end_date) {
    conditions.push("issue_date <= ?");
    params.push(end_date);
  }

  const relevanceSql = `
    (CASE
      WHEN name LIKE ? THEN 10
      WHEN MATCH(name) AGAINST (? IN BOOLEAN MODE) THEN 8
      ELSE 0
    END +
    CASE
      WHEN keywords LIKE ? THEN 5
      ELSE 0
    END +
    CASE
      WHEN MATCH(content) AGAINST (? IN BOOLEAN MODE) THEN 3
      WHEN content LIKE ? THEN 2
      ELSE 0
    END) AS relevance
  `;

  const searchParams = [
    `%${q}%`,
    q,
    `%${q}%`,
    q,
    `%${q}%`,
  ];

  conditions.push("(name LIKE ? OR content LIKE ? OR keywords LIKE ?)");
  params.unshift(...searchParams);
  params.push(`%${q}%`, `%${q}%`, `%${q}%`);

  const where = " WHERE " + conditions.join(" AND ");

  const [[{ total }]] = await pool.execute(
    `SELECT COUNT(*) as total FROM laws${where}`,
    params.slice(5)
  );

  const limit = parseInt(size);
  const offset = (parseInt(page) - 1) * limit;

  const [data] = await pool.query(
    `SELECT id, name, law_no, category, issuing_authority, issue_date, is_valid, keywords,
     LEFT(content, 200) as content_snippet, ${relevanceSql}
     FROM laws${where}
     ORDER BY relevance DESC, created_at DESC
     LIMIT ${limit} OFFSET ${offset}`,
    params
  );

  data.forEach(item => {
    if (item.keywords) {
      item.keywords = item.keywords.split(",").filter(k => k.trim());
    } else {
      item.keywords = [];
    }
  });

  res.json({ total, page: parseInt(page), size: limit, data });
});

router.get("/:id", async (req, res) => {
  const [[row]] = await pool.execute("SELECT * FROM laws WHERE id = ?", [req.params.id]);
  if (!row) return res.status(404).json({ error: "法规不存在" });

  if (row.keywords) {
    row.keywords = row.keywords.split(",").filter(k => k.trim());
  } else {
    row.keywords = [];
  }

  const [revisions] = await pool.execute(
    `SELECT lr.*, l.name as old_name, l2.name as new_name
     FROM law_revisions lr
     LEFT JOIN laws l ON lr.old_law_id = l.id
     LEFT JOIN laws l2 ON lr.new_law_id = l2.id
     WHERE lr.old_law_id = ? OR lr.new_law_id = ?
     ORDER BY lr.revision_date ASC`,
    [req.params.id, req.params.id]
  );

  row.revisions = revisions;
  res.json(row);
});

router.put("/:id", async (req, res) => {
  const { name, law_no, issuing_authority, issue_date, effective_date, category, content, keywords, is_valid } = req.body;
  const [[law]] = await pool.execute("SELECT id FROM laws WHERE id = ?", [req.params.id]);
  if (!law) return res.status(404).json({ error: "法规不存在" });

  if (category && !VALID_CATEGORIES.includes(category)) {
    return res.status(400).json({ error: "无效的法规类别" });
  }

  const fields = [];
  const values = [];

  if (name !== undefined) { fields.push("name = ?"); values.push(name); }
  if (law_no !== undefined) { fields.push("law_no = ?"); values.push(law_no); }
  if (issuing_authority !== undefined) { fields.push("issuing_authority = ?"); values.push(issuing_authority); }
  if (issue_date !== undefined) { fields.push("issue_date = ?"); values.push(issue_date); }
  if (effective_date !== undefined) { fields.push("effective_date = ?"); values.push(effective_date); }
  if (category !== undefined) { fields.push("category = ?"); values.push(category); }
  if (content !== undefined) { fields.push("content = ?"); values.push(content); }
  if (keywords !== undefined) {
    fields.push("keywords = ?");
    values.push(Array.isArray(keywords) ? keywords.join(",") : (keywords || ""));
  }
  if (is_valid !== undefined) { fields.push("is_valid = ?"); values.push(is_valid); }

  if (fields.length === 0) {
    return res.status(400).json({ error: "没有需要更新的字段" });
  }

  values.push(req.params.id);
  await pool.execute(`UPDATE laws SET ${fields.join(", ")} WHERE id = ?`, values);
  res.json({ message: "法规更新成功" });
});

router.delete("/:id", async (req, res) => {
  const [result] = await pool.execute("DELETE FROM laws WHERE id = ?", [req.params.id]);
  if (result.affectedRows === 0) return res.status(404).json({ error: "法规不存在" });
  res.json({ message: "法规删除成功" });
});

router.post("/:id/revisions", async (req, res) => {
  const { new_law_id, revision_date, note } = req.body;
  const old_law_id = parseInt(req.params.id);

  if (!new_law_id) {
    return res.status(400).json({ error: "新法规ID为必填" });
  }

  const [[oldLaw]] = await pool.execute("SELECT id FROM laws WHERE id = ?", [old_law_id]);
  if (!oldLaw) return res.status(404).json({ error: "旧法规不存在" });

  const [[newLaw]] = await pool.execute("SELECT id FROM laws WHERE id = ?", [new_law_id]);
  if (!newLaw) return res.status(404).json({ error: "新法规不存在" });

  try {
    const [result] = await pool.execute(
      "INSERT INTO law_revisions (old_law_id, new_law_id, revision_date, note) VALUES (?,?,?,?)",
      [old_law_id, new_law_id, revision_date || null, note || null]
    );
    res.status(201).json({ id: result.insertId, message: "修订记录添加成功" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/:id/revisions", async (req, res) => {
  const [revisions] = await pool.execute(
    `SELECT lr.*, l.name as old_name, l2.name as new_name
     FROM law_revisions lr
     LEFT JOIN laws l ON lr.old_law_id = l.id
     LEFT JOIN laws l2 ON lr.new_law_id = l2.id
     WHERE lr.old_law_id = ? OR lr.new_law_id = ?
     ORDER BY lr.revision_date ASC`,
    [req.params.id, req.params.id]
  );
  res.json(revisions);
});

module.exports = router;
