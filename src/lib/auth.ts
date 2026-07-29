import "@tanstack/react-start/server-only";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

export const SESSION_COOKIE = "session";
const SESSION_TTL = "30d";

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("Missing JWT_SECRET environment variable.");
  return secret;
}

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function signSessionToken(userId: string): string {
  return jwt.sign({ sub: userId }, getJwtSecret(), { expiresIn: SESSION_TTL });
}

export function verifySessionToken(token: string): { userId: string } | null {
  try {
    const payload = jwt.verify(token, getJwtSecret());
    if (typeof payload === "object" && typeof payload.sub === "string") {
      return { userId: payload.sub };
    }
    return null;
  } catch {
    return null;
  }
}
