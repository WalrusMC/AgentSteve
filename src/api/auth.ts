import "dotenv/config";

export async function auth(req: any, res: any, next: any) {
  const authHeader = req.headers?.authorization;
  const expected = `Bearer ${process.env.STEVE_INTERNAL_KEY}`;

  if (authHeader !== expected) return res.status(401).send("Unauthorized");

  next();
}
