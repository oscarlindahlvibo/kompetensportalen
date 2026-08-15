"use client";

import { useEffect } from "react";

export default function LessonStart({ enrollmentId, lessonId }: { enrollmentId: string; lessonId: string }) {
  useEffect(() => {
    void fetch("/api/progress", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enrollmentId, lessonId, status: "started" }),
    });
  }, [enrollmentId, lessonId]);
  return null;
}
