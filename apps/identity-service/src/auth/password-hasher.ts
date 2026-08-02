import {
  randomBytes,
  scrypt,
  timingSafeEqual,
  type ScryptOptions,
} from "node:crypto";

import { Injectable } from "@nestjs/common";

const KEY_LENGTH = 64;
const OPTIONS: ScryptOptions = {
  N: 16384,
  r: 8,
  p: 1,
  maxmem: 64 * 1024 * 1024,
};

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, OPTIONS, (error, key) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(key as Buffer);
    });
  });
}

@Injectable()
export class PasswordHasher {
  async hash(password: string): Promise<string> {
    const salt = randomBytes(16);
    const derived = await derive(password, salt);

    return [
      "scrypt",
      "v=1",
      "N=16384",
      "r=8",
      "p=1",
      salt.toString("base64url"),
      derived.toString("base64url"),
    ].join("$");
  }

  async verify(password: string, encoded: string): Promise<boolean> {
    const parts = encoded.split("$");

    if (
      parts.length !== 7 ||
      parts[0] !== "scrypt" ||
      parts[1] !== "v=1" ||
      parts[2] !== "N=16384" ||
      parts[3] !== "r=8" ||
      parts[4] !== "p=1"
    ) {
      return false;
    }

    try {
      const salt = Buffer.from(parts[5], "base64url");
      const expected = Buffer.from(parts[6], "base64url");
      const actual = await derive(password, salt);

      return (
        expected.length === actual.length &&
        timingSafeEqual(expected, actual)
      );
    } catch {
      return false;
    }
  }
}
