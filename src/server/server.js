import express from "express";
import router from "./routes.js";
import "dotenv/config";

const PORT = process.env.PORT;
const HOSTNAME = process.env.HOSTNAME;

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Default files
app.use(express.static("public"));

// Routes
app.use("/", router);

// AI Agents 404
app.use("/aiagents", (req, res) => {
  res.status(404).sendFile("404.html", { root: "./public/html/aiAgents" });
});

app.listen(PORT, HOSTNAME, () => {
  console.log(`Server started: http://${HOSTNAME}:${PORT} `);
})
