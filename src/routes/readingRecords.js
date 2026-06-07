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
      "INSERT INTO reading_records (lawyer_id, target_type, target_id) VALUES (?,?,?)",
      [lawyer_id, target_type, target_id],
    );
    res.status(201).json({ id: result.insertId, message: "阅读记录已记录" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/lawyer/:lawyer_id", async (req, res) => {
  const { target_type, page = 1, size = 20 } = req.query;
  const lawyer_id = req.params.lawyer_id;

  const limit = parseInt(size);
  const offset = (parseInt(page) - 1) * limit;

  let conditions = ["rr.lawyer_id = ?"];
  let params = [lawyer_id];

  if (target_type) {
    conditions.push("rr.target_type = ?");
    params.push(target_type);
  }

  const where = " WHERE " + conditions.join(" AND ");

  const [[{ total }]] = await pool.execute(
    `SELECT COUNT(*) as total FROM reading_records rr${where}`,
    params,
  );

  const [records] = await pool.query(
    `SELECT rr.id, rr.target_type, rr.target_id, rr.read_at
     FROM reading_records rr${where}
     ORDER BY rr.read_at DESC
     LIMIT ${limit} OFFSET ${offset}`,
    params,
  );

  const lawIds = records
    .filter((r) => r.target_type === "law")
    .map((r) => r.target_id);
  const caseIds = records
    .filter((r) => r.target_type === "case")
    .map((r) => r.target_id);

  let lawMap = {};
  let caseMap = {};

  if (lawIds.length > 0) {
    const [laws] = await pool.query(
      `SELECT id, name, law_no, category, is_valid FROM laws WHERE id IN (?)`,
      [lawIds],
    );
    laws.forEach((l) => {
      lawMap[l.id] = l;
    });
  }

  if (caseIds.length > 0) {
    const [cases] = await pool.query(
      `SELECT id, title, case_type FROM case_library WHERE id IN (?)`,
      [caseIds],
    );
    cases.forEach((c) => {
      caseMap[c.id] = c;
    });
  }

  const data = records.map((r) => ({
    ...r,
    detail:
      r.target_type === "law" ? lawMap[r.target_id] : caseMap[r.target_id],
  }));

  res.json({ total, page: parseInt(page), size: limit, data });
});

router.get("/stats/target/:target_type/:target_id", async (req, res) => {
  const { target_type, target_id } = req.params;
  if (!["law", "case"].includes(target_type)) {
    return res.status(400).json({ error: "无效的目标类型" });
  }

  const [[{ total_reads }]] = await pool.execute(
    `SELECT COUNT(*) as total_reads FROM reading_records
     WHERE target_type = ? AND target_id = ?`,
    [target_type, target_id],
  );

  const [[{ unique_readers }]] = await pool.execute(
    `SELECT COUNT(DISTINCT lawyer_id) as unique_readers FROM reading_records
     WHERE target_type = ? AND target_id = ?`,
    [target_type, target_id],
  );

  res.json({ total_reads, unique_readers });
});

module.exports = router;
