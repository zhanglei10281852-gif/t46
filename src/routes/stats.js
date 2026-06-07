const { Router } = require("express");
const { pool } = require("../db");
const router = Router();

router.get("/laws/by-category", async (req, res) => {
  const [data] = await pool.execute(
    `SELECT category, COUNT(*) as count FROM laws
     GROUP BY category ORDER BY count DESC`,
  );
  res.json(data);
});

router.get("/cases/by-type", async (req, res) => {
  const [data] = await pool.execute(
    `SELECT case_type, COUNT(*) as count FROM case_library
     WHERE status = '已通过'
     GROUP BY case_type ORDER BY count DESC`,
  );
  res.json(data);
});

router.get("/monthly/laws", async (req, res) => {
  const { months = 12 } = req.query;
  const limit = parseInt(months);

  const [data] = await pool.query(
    `SELECT DATE_FORMAT(created_at, '%Y-%m') as month,
            COUNT(*) as count
     FROM laws
     WHERE created_at >= DATE_SUB(NOW(), INTERVAL ${limit} MONTH)
     GROUP BY DATE_FORMAT(created_at, '%Y-%m')
     ORDER BY month ASC`,
  );
  res.json(data);
});

router.get("/monthly/cases", async (req, res) => {
  const { months = 12 } = req.query;
  const limit = parseInt(months);

  const [data] = await pool.query(
    `SELECT DATE_FORMAT(created_at, '%Y-%m') as month,
            COUNT(*) as count
     FROM case_library
     WHERE status = '已通过'
       AND created_at >= DATE_SUB(NOW(), INTERVAL ${limit} MONTH)
     GROUP BY DATE_FORMAT(created_at, '%Y-%m')
     ORDER BY month ASC`,
  );
  res.json(data);
});

router.get("/top/laws", async (req, res) => {
  const { limit = 10 } = req.query;
  const topLimit = parseInt(limit);

  const [data] = await pool.query(
    `SELECT l.id, l.name, l.law_no, l.category, l.is_valid,
            COUNT(rr.id) as read_count,
            COUNT(DISTINCT rr.lawyer_id) as reader_count
     FROM laws l
     LEFT JOIN reading_records rr ON rr.target_type = 'law' AND rr.target_id = l.id
     GROUP BY l.id
     ORDER BY read_count DESC, l.id ASC
     LIMIT ${topLimit}`,
  );
  res.json(data);
});

router.get("/top/cases", async (req, res) => {
  const { limit = 10 } = req.query;
  const topLimit = parseInt(limit);

  const [data] = await pool.query(
    `SELECT cl.id, cl.title, cl.case_type,
            COUNT(rr.id) as read_count,
            COUNT(DISTINCT rr.lawyer_id) as reader_count
     FROM case_library cl
     LEFT JOIN reading_records rr ON rr.target_type = 'case' AND rr.target_id = cl.id
     WHERE cl.status = '已通过'
     GROUP BY cl.id
     ORDER BY read_count DESC, cl.id ASC
     LIMIT ${topLimit}`,
  );
  res.json(data);
});

router.get("/lawyer-activity", async (req, res) => {
  const { page = 1, size = 20 } = req.query;

  const [[{ total }]] = await pool.execute(
    `SELECT COUNT(DISTINCT l.id) as total FROM lawyers l`,
  );

  const limit = parseInt(size);
  const offset = (parseInt(page) - 1) * limit;

  const [data] = await pool.query(
    `SELECT l.id, l.name, l.firm,
            COALESCE(r.read_count, 0) as read_count,
            COALESCE(f.favorite_count, 0) as favorite_count,
            COALESCE(r.read_count, 0) + COALESCE(f.favorite_count, 0) as activity_score
     FROM lawyers l
     LEFT JOIN (
       SELECT lawyer_id, COUNT(*) as read_count
       FROM reading_records
       GROUP BY lawyer_id
     ) r ON l.id = r.lawyer_id
     LEFT JOIN (
       SELECT lawyer_id, COUNT(*) as favorite_count
       FROM favorites
       GROUP BY lawyer_id
     ) f ON l.id = f.lawyer_id
     ORDER BY activity_score DESC, l.id ASC
     LIMIT ${limit} OFFSET ${offset}`,
  );

  res.json({ total, page: parseInt(page), size: limit, data });
});

router.get("/overview", async (req, res) => {
  const [[lawTotal]] = await pool.execute("SELECT COUNT(*) as count FROM laws");
  const [[lawValid]] = await pool.execute(
    "SELECT COUNT(*) as count FROM laws WHERE is_valid = 1",
  );
  const [[caseTotal]] = await pool.execute(
    "SELECT COUNT(*) as count FROM case_library WHERE status = '已通过'",
  );
  const [[casePending]] = await pool.execute(
    "SELECT COUNT(*) as count FROM case_library WHERE status = '待审核'",
  );
  const [[readTotal]] = await pool.execute(
    "SELECT COUNT(*) as count FROM reading_records",
  );
  const [[favoriteTotal]] = await pool.execute(
    "SELECT COUNT(*) as count FROM favorites",
  );

  const [lawByCategory] = await pool.execute(
    `SELECT category, COUNT(*) as count FROM laws GROUP BY category ORDER BY count DESC`,
  );

  const [caseByType] = await pool.execute(
    `SELECT case_type, COUNT(*) as count FROM case_library
     WHERE status = '已通过'
     GROUP BY case_type ORDER BY count DESC`,
  );

  res.json({
    laws: {
      total: lawTotal.count,
      valid: lawValid.count,
    },
    cases: {
      total: caseTotal.count,
      pending: casePending.count,
    },
    interactions: {
      reads: readTotal.count,
      favorites: favoriteTotal.count,
    },
    law_by_category: lawByCategory,
    case_by_type: caseByType,
  });
});

module.exports = router;
