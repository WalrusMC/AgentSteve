import express from "express";
import { guildChecker, googleOAuth, serverAccessChecker } from "./controllers/index.js";

const router = express.Router();

router.get("/guilds/check", guildChecker);

router.post("/oauth/google/callback", googleOAuth);
router.post("/serveraccess/check", serverAccessChecker);

export default router;