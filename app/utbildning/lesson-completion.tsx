"use client";

import { useState } from "react";

export default function LessonCompletion({ enrollmentId, lessonId }: { enrollmentId: string; lessonId: string }) {
  const [state, setState] = useState<"idle" | "saving" | "done">("idle");
  async function complete() {
    setState("saving");
    const response = await fetch("/api/progress", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ enrollmentId, lessonId, status: "completed" }) });
    setState(response.ok ? "done" : "idle");
  }
  return <button className="button button-dark lesson-complete" onClick={complete} disabled={state !== "idle"}>{state === "done" ? "Lektion slutförd ✓" : state === "saving" ? "Sparar..." : "Markera som slutförd →"}</button>;
}
