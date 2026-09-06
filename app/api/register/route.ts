import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    {
      error:
        "Account registration is disabled. Accounts are centrally managed via Automation Alchemists.",
    },
    { status: 404 }
  );
}
