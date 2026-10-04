import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { getErrorDetails } from "@/lib/error-details";

type SupabaseUser = Awaited<ReturnType<ReturnType<typeof createServerClient>["auth"]["getUser"]>>["data"]["user"];

function isRefreshTokenRace(error: unknown) {
  const { code, message } = getErrorDetails(error);
  return code === "refresh_token_already_used" ||
    message.includes("refresh_token_already_used") ||
    message.includes("already been used");
}

export type SessionUpdateResult = {
  response: NextResponse;
  user: SupabaseUser;
  isRaceCondition: boolean;
};

export async function updateSession(request: NextRequest): Promise<SessionUpdateResult> {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabaseUrl = process.env.NEXT_PUBLIC_AA_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_AA_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return { response: supabaseResponse, user: null, isRaceCondition: false };
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({
          request,
        });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        );
      },
    },
  });

  let user: SupabaseUser = null;
  let isRaceCondition = false;

  try {
    const { data, error } = await supabase.auth.getUser();

    if (error) {
      // Concurrency Guard: Check for concurrent token rotation race
      isRaceCondition = isRefreshTokenRace(error);

      if (isRaceCondition) {
        // Do NOT delete cookies. A parallel browser request already rotated the token.
        // Proceed with downstream request handling.
      } else {
        // Genuine invalid/expired session
        user = null;
      }
    } else {
      user = data.user;
    }
  } catch (err: unknown) {
    if (isRefreshTokenRace(err)) {
      isRaceCondition = true;
    }
  }

  return { response: supabaseResponse, user, isRaceCondition };
}
