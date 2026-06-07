const { Router } = require("express");
const { pool } = require("../db");
const router = Router();

const VALID_TYPES = ["民事", "刑事", "行政", "劳动争议", "婚姻家庭", "其他"];
const VALID_STATUS = ["待审核", "已通过", "已驳回"];

router.post("/", async (req, res) => {
  const {
    title,
    case_type,
    keywords,
    summary,
    dispute_focus,
    handling_process,
    judgment_result,
    typical_significance,
    submitter_id,
    law_refs,
  } = req.body;
  if (!title || !case_type) {
    return res.status(400).json({ error: "案例标题和案件类型为必填" });
  }
  if (!VALID_TYPES.includes(case_type)) {
    return res.status(400).json({ error: "无效的案件类型" });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const keywordsStr = Array.isArray(keywords)
      ? keywords.join(",")
      : keywords || "";
    const [result] = await conn.execute(
      `INSERT INTO case_library (title, case_type, keywords, summary, dispute_focus, handling_process, judgment_result, typical_significance, submitter_id)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [
        title,
        case_type,
        keywordsStr,
        summary || null,
        dispute_focus || null,
        handling_process || null,
        judgment_result || null,
        typical_significance || null,
        submitter_id || null,
      ],
    );

    const caseId = result.insertId;

    if (Array.isArray(law_refs) && law_refs.length > 0) {
      for (const lawId of law_refs) {
        try {
          await conn.execute(
            "INSERT IGNORE INTO case_law_refs (case_id, law_id) VALUES (?,?)",
            [caseId, lawId],
          );
        } catch (e) {}
      }
    }

    await conn.commit();
    res.status(201).json({ id: caseId, message: "案例提交成功，等待审核" });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ error: e.message });
  } finally {
    conn.release();
  }
});

router.get("/", async (req, res) => {
  const {
    case_type,
    status,
    keyword,
    tag,
    submitter_id,
    page = 1,
    size = 20,
  } = req.query;
  let conditions = [];
  let params = [];

  if (status) {
    conditions.push("cl.status = ?");
    params.push(status);
  } else {
    conditions.push("cl.status = '已通过'");
  }

  if (case_type) {
    conditions.push("cl.case_type = ?");
    params.push(case_type);
  }
  if (tag) {
    conditions.push("cl.keywords LIKE ?");
    params.push(`%${tag}%`);
  }
  if (submitter_id) {
    conditions.push("cl.submitter_id = ?");
    params.push(submitter_id);
  }

  let selectSql = "SELECT cl.*, l.name as submitter_name";
  let orderBy = "ORDER BY cl.created_at DESC";

  if (keyword) {
    selectSql = `SELECT cl.*, l.name as submitter_name,
      (CASE WHEN cl.title LIKE ? THEN 5 ELSE 0 END
       + CASE WHEN cl.keywords LIKE ? THEN 3 ELSE 0 END
       + CASE WHEN cl.summary LIKE ? THEN 2 ELSE 0 END
       + CASE WHEN cl.dispute_focus LIKE ? THEN 1 ELSE 0 END) AS relevance`;
    params.unshift(
      `%${keyword}%`,
      `%${keyword}%`,
      `%${keyword}%`,
      `%${keyword}%`,
    );
    conditions.push(
      "(cl.title LIKE ? OR cl.keywords LIKE ? OR cl.summary LIKE ? OR cl.dispute_focus LIKE ?)",
    );
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
    orderBy = "ORDER BY relevance DESC, cl.created_at DESC";
  }

  const where = " WHERE " + conditions.join(" AND ");
  const fromJoin =
    " FROM case_library cl LEFT JOIN lawyers l ON cl.submitter_id = l.id";

  const [[{ total }]] = await pool.execute(
    `SELECT COUNT(*) as total ${fromJoin}${where}`,
    params.slice(keyword ? 4 : 0),
  );

  const limit = parseInt(size);
  const offset = (parseInt(page) - 1) * limit;

  const [data] = await pool.query(
    `${selectSql} ${fromJoin}${where} ${orderBy} LIMIT ${limit} OFFSET ${offset}`,
    params,
  );

  data.forEach((item) => {
    if (item.keywords) {
      item.keywords = item.keywords.split(",").filter((k) => k.trim());
    } else {
      item.keywords = [];
    }
  });

  res.json({ total, page: parseInt(page), size: limit, data });
});

router.get("/search", async (req, res) => {
  const { q, case_type, page = 1, size = 20 } = req.query;
  if (!q) {
    return res.status(400).json({ error: "搜索关键词不能为空" });
  }

  let conditions = ["cl.status = '已通过'"];
  let params = [];

  if (case_type) {
    conditions.push("cl.case_type = ?");
    params.push(case_type);
  }

  const relevanceSql = `
    (CASE
      WHEN cl.title LIKE ? THEN 10
      WHEN MATCH(cl.title) AGAINST (? IN BOOLEAN MODE) THEN 8
      ELSE 0
    END +
    CASE
      WHEN cl.keywords LIKE ? THEN 5
      ELSE 0
    END +
    CASE
      WHEN MATCH(cl.summary) AGAINST (? IN BOOLEAN MODE) THEN 3
      WHEN cl.summary LIKE ? THEN 2
      ELSE 0
    END) AS relevance
  `;

  const searchParams = [`%${q}%`, q, `%${q}%`, q, `%${q}%`];

  conditions.push(
    "(cl.title LIKE ? OR cl.summary LIKE ? OR cl.keywords LIKE ?)",
  );
  params.unshift(...searchParams);
  params.push(`%${q}%`, `%${q}%`, `%${q}%`);

  const where = " WHERE " + conditions.join(" AND ");
  const fromJoin =
    " FROM case_library cl LEFT JOIN lawyers l ON cl.submitter_id = l.id";

  const [[{ total }]] = await pool.execute(
    `SELECT COUNT(*) as total ${fromJoin}${where}`,
    params.slice(5),
  );

  const limit = parseInt(size);
  const offset = (parseInt(page) - 1) * limit;

  const [data] = await pool.query(
    `SELECT cl.id, cl.title, cl.case_type, cl.keywords, cl.summary, cl.created_at,
     l.name as submitter_name, ${relevanceSql}
     ${fromJoin}${where}
     ORDER BY relevance DESC, cl.created_at DESC
     LIMIT ${limit} OFFSET ${offset}`,
    params,
  );

  data.forEach((item) => {
    if (item.keywords) {
      item.keywords = item.keywords.split(",").filter((k) => k.trim());
    } else {
      item.keywords = [];
    }
  });

  res.json({ total, page: parseInt(page), size: limit, data });
});

router.get("/by-law/:law_id", async (req, res) => {
  const { page = 1, size = 20 } = req.query;
  const law_id = req.params.law_id;

  const [[law]] = await pool.execute("SELECT id FROM laws WHERE id = ?", [
    law_id,
  ]);
  if (!law) return res.status(404).json({ error: "法规不存在" });

  const [[{ total }]] = await pool.execute(
    `SELECT COUNT(*) as total FROM case_law_refs clr
     JOIN case_library cl ON clr.case_id = cl.id
     WHERE clr.law_id = ? AND cl.status = '已通过'`,
    [law_id],
  );

  const limit = parseInt(size);
  const offset = (parseInt(page) - 1) * limit;

  const [data] = await pool.query(
    `SELECT cl.*, l.name as submitter_name FROM case_law_refs clr
     JOIN case_library cl ON clr.case_id = cl.id
     LEFT JOIN lawyers l ON cl.submitter_id = l.id
     WHERE clr.law_id = ? AND cl.status = '已通过'
     ORDER BY cl.created_at DESC
     LIMIT ${limit} OFFSET ${offset}`,
    [law_id],
  );

  data.forEach((item) => {
    if (item.keywords) {
      item.keywords = item.keywords.split(",").filter((k) => k.trim());
    } else {
      item.keywords = [];
    }
  });

  res.json({ total, page: parseInt(page), size: limit, data });
});

router.get("/:id", async (req, res) => {
  const [[row]] = await pool.execute(
    `SELECT cl.*, l.name as submitter_name, l2.name as reviewer_name
     FROM case_library cl
     LEFT JOIN lawyers l ON cl.submitter_id = l.id
     LEFT JOIN lawyers l2 ON cl.reviewer_id = l2.id
     WHERE cl.id = ?`,
    [req.params.id],
  );
  if (!row) return res.status(404).json({ error: "案例不存在" });

  if (row.keywords) {
    row.keywords = row.keywords.split(",").filter((k) => k.trim());
  } else {
    row.keywords = [];
  }

  const [lawRefs] = await pool.execute(
    `SELECT l.id, l.name, l.law_no, l.category FROM case_law_refs clr
     JOIN laws l ON clr.law_id = l.id
     WHERE clr.case_id = ?
     ORDER BY l.name`,
    [req.params.id],
  );
  row.law_refs = lawRefs;

  res.json(row);
});

router.put("/:id", async (req, res) => {
  const {
    title,
    case_type,
    keywords,
    summary,
    dispute_focus,
    handling_process,
    judgment_result,
    typical_significance,
    law_refs,
  } = req.body;
  const [[caseItem]] = await pool.execute(
    "SELECT id, status FROM case_library WHERE id = ?",
    [req.params.id],
  );
  if (!caseItem) return res.status(404).json({ error: "案例不存在" });

  if (case_type && !VALID_TYPES.includes(case_type)) {
    return res.status(400).json({ error: "无效的案件类型" });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const fields = [];
    const values = [];

    if (title !== undefined) {
      fields.push("title = ?");
      values.push(title);
    }
    if (case_type !== undefined) {
      fields.push("case_type = ?");
      values.push(case_type);
    }
    if (keywords !== undefined) {
      fields.push("keywords = ?");
      values.push(
        Array.isArray(keywords) ? keywords.join(",") : keywords || "",
      );
    }
    if (summary !== undefined) {
      fields.push("summary = ?");
      values.push(summary);
    }
    if (dispute_focus !== undefined) {
      fields.push("dispute_focus = ?");
      values.push(dispute_focus);
    }
    if (handling_process !== undefined) {
      fields.push("handling_process = ?");
      values.push(handling_process);
    }
    if (judgment_result !== undefined) {
      fields.push("judgment_result = ?");
      values.push(judgment_result);
    }
    if (typical_significance !== undefined) {
      fields.push("typical_significance = ?");
      values.push(typical_significance);
    }

    if (fields.length > 0) {
      values.push(req.params.id);
      await conn.execute(
        `UPDATE case_library SET ${fields.join(", ")} WHERE id = ?`,
        values,
      );
    }

    if (Array.isArray(law_refs)) {
      await conn.execute("DELETE FROM case_law_refs WHERE case_id = ?", [
        req.params.id,
      ]);
      for (const lawId of law_refs) {
        try {
          await conn.execute(
            "INSERT IGNORE INTO case_law_refs (case_id, law_id) VALUES (?,?)",
            [req.params.id, lawId],
          );
        } catch (e) {}
      }
    }

    if (caseItem.status === "已通过") {
      await conn.execute(
        "UPDATE case_library SET status = '待审核' WHERE id = ?",
        [req.params.id],
      );
    }

    await conn.commit();
    res.json({ message: "案例更新成功，已重新进入审核队列" });
  } catch (e) {
    await conn.rollback();
    res.status(500).json({ error: e.message });
  } finally {
    conn.release();
  }
});

router.delete("/:id", async (req, res) => {
  const [result] = await pool.execute("DELETE FROM case_library WHERE id = ?", [
    req.params.id,
  ]);
  if (result.affectedRows === 0)
    return res.status(404).json({ error: "案例不存在" });
  res.json({ message: "案例删除成功" });
});

router.put("/:id/review", async (req, res) => {
  const { action, reviewer_id, review_comment } = req.body;
  if (!action || !["approve", "reject"].includes(action)) {
    return res.status(400).json({ error: "无效的审核操作" });
  }

  const [[caseItem]] = await pool.execute(
    "SELECT id, status FROM case_library WHERE id = ?",
    [req.params.id],
  );
  if (!caseItem) return res.status(404).json({ error: "案例不存在" });
  if (caseItem.status !== "待审核") {
    return res.status(400).json({ error: "只有待审核状态的案例可以审核" });
  }

  if (action === "approve") {
    await pool.execute(
      `UPDATE case_library SET status = '已通过', reviewer_id = ?, review_comment = ?, review_time = NOW() WHERE id = ?`,
      [reviewer_id || null, review_comment || null, req.params.id],
    );
    res.json({ message: "案例审核通过" });
  } else {
    if (!review_comment) {
      return res.status(400).json({ error: "驳回必须填写审核意见" });
    }
    await pool.execute(
      `UPDATE case_library SET status = '已驳回', reviewer_id = ?, review_comment = ?, review_time = NOW() WHERE id = ?`,
      [reviewer_id || null, review_comment, req.params.id],
    );
    res.json({ message: "案例已驳回" });
  }
});

module.exports = router;
