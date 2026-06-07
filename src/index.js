const express = require("express");
const cors = require("cors");
const { initDb } = require("./db");
const applicantRoutes = require("./routes/applicants");
const caseRoutes = require("./routes/cases");
const lawyerRoutes = require("./routes/lawyers");
const lawRoutes = require("./routes/laws");
const caseLibraryRoutes = require("./routes/caseLibrary");
const favoriteRoutes = require("./routes/favorites");
const readingRecordRoutes = require("./routes/readingRecords");
const statsRoutes = require("./routes/stats");

const app = express();
const PORT = 7290;

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.json({ service: "法律援助管理平台", version: "1.0.0" });
});

app.use("/api/applicants", applicantRoutes);
app.use("/api/cases", caseRoutes);
app.use("/api/lawyers", lawyerRoutes);
app.use("/api/laws", lawRoutes);
app.use("/api/case-library", caseLibraryRoutes);
app.use("/api/favorites", favoriteRoutes);
app.use("/api/reading-records", readingRecordRoutes);
app.use("/api/stats", statsRoutes);

async function start() {
  await initDb();
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`法律援助平台启动成功，端口: ${PORT}`);
  });
}

start().catch((err) => {
  console.error("启动失败:", err);
  process.exit(1);
});
