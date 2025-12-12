import express from "express";
import router from "./routes.js";
import "dotenv/config";

const PORT = process.env.PORT;
const HOSTNAME = process.env.HOSTNAME;

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(express.static("public"));

app.use("/", router);

app.listen(PORT, HOSTNAME, () => {
  console.log(`Server started: http://${HOSTNAME}:${PORT} `);
})
