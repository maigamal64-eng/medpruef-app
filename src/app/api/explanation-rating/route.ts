import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

export async function POST(req: NextRequest) {
  try {
    const { questionId, rating } = await req.json();

    if (!questionId || (rating !== 1 && rating !== -1)) {
      return NextResponse.json(
        { error: "Invalid request. questionId and rating (1 or -1) required." },
        { status: 400 }
      );
    }

    const supabase = getServiceClient();

    // Use RPC or raw SQL to atomically increment
    const { error } = await supabase.rpc("increment_explanation_rating", {
      q_id: questionId,
      rating_val: rating,
    });

    // Fallback: if RPC doesn't exist, do manual update
    if (error?.message?.includes("function") || error?.code === "42883") {
      // Manual approach: fetch current, then update
      const { data: current } = await supabase
        .from("questions")
        .select("explanation_rating_sum, explanation_rating_count")
        .eq("id", questionId)
        .single();

      const newSum = (current?.explanation_rating_sum || 0) + rating;
      const newCount = (current?.explanation_rating_count || 0) + 1;

      const { error: updateError } = await supabase
        .from("questions")
        .update({
          explanation_rating_sum: newSum,
          explanation_rating_count: newCount,
        })
        .eq("id", questionId);

      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 500 });
      }
    } else if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
