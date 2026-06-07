const { Router } = require("express");
const { pool } = require("../db");
const router = Router();

router.post("/", async (req, res) => {
  const { lawyer_id, target_type, target_id } = req.body;
  if (!lawyer_id || !target_type || !target_id) {
    return res.status(400).json({ error: "律师ID、目标类型、目标ID为必填" });
  }
  if (!["law", "case"].includes(target_type)) {
    return res.status(400).json({ error: "无效的目标类型" });
  }

  const [[lawyer]] = await pool.execute("SELECT id FROM lawyers WHERE id = ?", [
    lawyer_id,
  ]);
  if (!lawyer) return res.status(404).json({ error: "律师不存在" });

  if (target_type === "law") {
    const [[law]] = await pool.execute("SELECT id FROM laws WHERE id = ?", [
      target_id,
    ]);
    if (!law) return res.status(404).json({ error: "法规不存在" });
  } else {
    const [[caseItem]] = await pool.execute(
      "SELECT id FROM case_library WHERE id = ?",
      [target_id],
    );
    if (!caseItem) return res.status(404).json({ error: "案例不存在" });
  }

  try {
    const [result] = await pool.execute(
      "INSERT INTO favorites (lawyer_id, target_type, target_id) VALUES (?,?,?)",
      [lawyer_id, target_type, target_id],
    );
    res.status(201).json({ id: result.insertId, message: "收藏成功" });
  } catch (e) {
    if (e.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "已经收藏过了" });
    }
    res.status(500).json({ error: e.message });
  }
});

router.delete("/", async (req, res) => {
  const { lawyer_id, target_type, target_id } = req.body;
  if (!lawyer_id || !target_type || !target_id) {
    return res.status(400).json({ error: "律师ID、目标类型、目标ID为必填" });
  }

  const [result] = await pool.execute(
    "DELETE FROM favorites WHERE lawyer_id = ? AND target_type = ? AND target_id = ?",
    [lawyer_id, target_type, target_id],
  );
  if (result.affectedRows === 0) {
    return res.status(404).json({ error: "收藏不存在" });
  }
  res.json({ message: "取消收藏成功" });
});

router.get("/lawyer/:lawyer_id", async (req, res) => {
  const { target_type, page = 1, size = 20 } = req.query;
  const lawyer_id = req.params.lawyer_id;

  let conditions = ["f.lawyer_id = ?"];
  let params = [lawyer_id];

  if (target_type) {
    conditions.push("f.target_type = ?");
    params.push(target_type);
  }

  const where = " WHERE " + conditions.join(" AND ");

  const [[{ total }]] = await pool.execute(
    `SELECT COUNT(*) as total FROM favorites f${where}`,
    params,
  );

  const limit = parseInt(size);
  const offset = (parseInt(page) - 1) * limit;

  const [lawFavorites] = await pool.query(
    `SELECT f.id as favorite_id, f.created_at as favorited_at,
            'law' as target_type, l.id, l.name, l.law_no, l.category, l.issuing_authority, l.is_valid
     FROM favorites f JOIN laws l ON f.target_id = l.id
     WHERE f.lawyer_id = ? AND f.target_type = 'law'
     ORDER BY f.created_at DESC`,
    [lawyer_id],
  );

  const [caseFavorites] = await pool.query(
    `SELECT f.id as favorite_id, f.created_at as favorited_at,
            'case' as target_type, cl.id, cl.title, cl.case_type, cl.summary
     FROM favorites f JOIN case_library cl ON f.target_id = cl.id
     WHERE f.lawyer_id = ? AND f.target_type = 'case' AND cl.status = '已通过'
     ORDER BY f.created_at DESC`,
    [lawyer_id],
  );

  let allFavorites = [];
  if (!target_type || target_type === "law") {
    allFavorites = allFavorites.concat(lawFavorites);
  }
  if (!target_type || target_type === "case") {
    allFavorites = allFavorites.concat(caseFavorites);
  }

  allFavorites.sort(
    (a, b) => new Date(b.favorited_at) - new Date(a.favorited_at),
  );

  const paginatedData = allFavorites.slice(offset, offset + limit);

  res.json({
    total: allFavorites.length,
    page: parseInt(page),
    size: limit,
    data: paginatedData,
  });
});

router.get("/check", async (req, res) => {
  const { lawyer_id, target_type, target_id } = req.query;
  if (!lawyer_id || !target_type || !target_id) {
    return res.status(400).json({ error: "缺少必要参数" });
  }

  const [[favorite]] = await pool.execute(
    "SELECT id, created_at FROM favorites WHERE lawyer_id = ? AND target_type = ? AND target_id = ?",
    [lawyer_id, target_type, target_id],
  );

  res.json({ is_favorited: !!favorite, favorite });
});

module.exports = router;
