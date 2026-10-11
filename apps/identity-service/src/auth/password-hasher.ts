import {
  randomBytes,
  scrypt,
  timingSafeEqual,
  type ScryptOptions,
} from "node:crypto";

import { Injectable } from "@nestjs/common";
import { argon2id, hash as argon2Hash, needsRehash, verify as argon2Verify } from "argon2";

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
    return argon2Hash(password, {
      type: argon2id,
      memoryCost: 65_536,
      timeCost: 3,
      parallelism: 1,
      hashLength: 32,
      salt: randomBytes(16),
    });
  }

  async verify(password: string, encoded: string): Promise<boolean> {
    if (encoded.startsWith("$argon2id$")) {
      try {
        return await argon2Verify(encoded, password);
      } catch {
        return false;
      }
    }
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

  needsRehash(encoded: string): boolean {
    if (!encoded.startsWith("$argon2id$")) return true;
    try {
      return needsRehash(encoded, { memoryCost: 65_536, timeCost: 3, parallelism: 1 });
    } catch {
      return true;
    }
  }
}
