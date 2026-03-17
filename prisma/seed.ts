import "dotenv/config";
import { PrismaClient } from "../app/generated/prisma/client.js";
import { PrismaNeon } from "@prisma/adapter-neon";
import bcrypt from "bcryptjs";

const adapter = new PrismaNeon({
  connectionString: process.env.DATABASE_URL!,
});
const prisma = new PrismaClient({ adapter });

async function main() {
  const users = [
    {
      name: "Admin",
      email: "admin@listflow.com",
      password: "Admin@1234",
      role: "admin",
    },
    {
      name: "Alice",
      email: "alice@listflow.com",
      password: "Alice@1234",
      role: "user",
    },
    {
      name: "Bob",
      email: "bob@listflow.com",
      password: "Bob@1234",
      role: "user",
    },
    {
      name: "Carol",
      email: "carol@listflow.com",
      password: "Carol@1234",
      role: "user",
    },
  ];

  for (const user of users) {
    const hashedPassword = await bcrypt.hash(user.password, 12);

    await prisma.user.upsert({
      where: { email: user.email },
      update: {},
      create: {
        name: user.name,
        email: user.email,
        password: hashedPassword,
        role: user.role,
      },
    });

    console.log(`Seeded user: ${user.email}`);
  }

  console.log("Seeding complete!");
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
