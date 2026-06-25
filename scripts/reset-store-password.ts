import "dotenv/config";

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { validateStorePassword } from "../lib/store-password-policy";

type ResetTarget = {
  loginId: string;
  password: string;
};

const args = process.argv.slice(2);

function getArgValue(name: string) {
  const prefix = `${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) {
    return inline.slice(prefix.length);
  }

  const index = args.indexOf(name);
  if (index >= 0) {
    return args[index + 1];
  }

  return undefined;
}

function hasArg(name: string) {
  return args.includes(name);
}

function makePassword() {
  return `Lf-${crypto.randomBytes(10).toString("base64url")}-26!`;
}

function printUsage() {
  console.log(`
Usage:
  npm.cmd run store:reset-password -- store-1
  npm.cmd run store:reset-password -- store-2 --password "Strong-password-123!"
  npm.cmd run store:reset-password -- --all

Notes:
  - Generated passwords are written to C:\\tmp\\listflow-store-login-passwords.txt
  - Custom passwords only need to be non-empty.
`);
}

const explicitPassword = getArgValue("--password");
const allStores = hasArg("--all");
const loginId = args.find((arg) => !arg.startsWith("--"));

if (hasArg("--help") || (!allStores && !loginId)) {
  printUsage();
  process.exit(hasArg("--help") ? 0 : 1);
}

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is missing.");
  process.exit(1);
}

async function main() {
  const generatedModule = await import("../app/generated/prisma/client");
  const generated =
    "PrismaClient" in generatedModule
      ? generatedModule
      : (generatedModule as unknown as { default: typeof generatedModule }).default;
  const { PrismaClient } = generated;
  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL,
  });
  const prisma = new PrismaClient({ adapter });

  try {
    const stores = await prisma.store.findMany({
      where: allStores ? { loginId: { not: null } } : { loginId },
      orderBy: { loginId: "asc" },
      select: {
        id: true,
        loginId: true,
        name: true,
        isActive: true,
      },
    });

    if (stores.length === 0) {
      throw new Error(allStores ? "No store logins found." : `Store ${loginId} was not found.`);
    }

    if (explicitPassword && stores.length > 1) {
      throw new Error("Use a generated password when resetting multiple stores.");
    }

  const resetTargets: ResetTarget[] = stores.map((store) => {
    const password = explicitPassword || makePassword();
    const policy = validateStorePassword(password);

      if (!policy.valid) {
        throw new Error(`Password rejected for ${store.loginId}: ${policy.errors.join(" ")}`);
      }

      return {
        loginId: store.loginId ?? store.id,
        password,
      };
    });

    for (const target of resetTargets) {
      const hashedPassword = await bcrypt.hash(target.password, 12);
      await prisma.store.update({
        where: { loginId: target.loginId },
        data: {
          password: hashedPassword,
          isActive: true,
        },
      });
    }

    const outputPath = path.join("C:", "tmp", "listflow-store-login-passwords.txt");
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });

    const output = [
      "ListFlow temporary store login passwords",
      `Created: ${new Date().toISOString()}`,
      "Do not commit this file. Delete it after saving the passwords privately.",
      "",
      ...resetTargets.map(
        (target) => `Store ID: ${target.loginId}\nPassword: ${target.password}\n`,
      ),
    ].join("\n");

    fs.writeFileSync(outputPath, output, "utf8");

    console.log(`Reset ${resetTargets.length} store password(s).`);
    console.log(`Credentials written to ${outputPath}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
