import express from "express";
import { googleOAuth } from "./controllers/googleOAuth.js";
import { serverAccessPage, serverAccessChecker } from "./controllers/serverAccess.js";

const router = express.Router();

router.get("/oauth/google/callback", googleOAuth);
router.get("/aiagents/serveraccess", serverAccessPage);
router.post("/aiagents/serveraccess/check", serverAccessChecker);

export default router;