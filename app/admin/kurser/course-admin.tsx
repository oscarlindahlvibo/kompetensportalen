"use client";

import { useEffect, useRef, useState } from "react";

type Course = {
  id: string;
  name: string;
  slug: string;
  status: string;
  priceSek: number;
  shortDescription?: string;
  fullDescription?: string;
  category?: string;
  campaignPriceSek?: number | null;
  vatRate?: number;
  validityMonths?: number | null;
  estimatedMinutes?: number;
  targetAudience?: string | null;
  prerequisites?: string | null;
  regulatoryFramework?: string | null;
  competenceCode?: string | null;
  requiresIdentityVerification?: boolean;
  id06Enabled?: boolean;
  imageUrl?: string | null;
  bannerUrl?: string | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
  tagsJson?: string;
};
type Version = {
  id: string;
  courseId: string;
  version: string;
  status: string;
};
type GoverningDocument = {
  id: string;
  title: string;
  documentNumber: string | null;
  version: string | null;
};
type Block = {
  type:
    | "text"
    | "richtext"
    | "heading"
    | "list"
    | "table"
    | "link"
    | "embed"
    | "image"
    | "video"
    | "document"
    | "callout";
  text: string;
  url: string;
  title: string;
};
type LessonDraft = {
  title: string;
  type: "article" | "video" | "image" | "document" | "quiz" | "exam" | "mixed";
  required: boolean;
  blocks: Block[];
};
type ChapterDraft = {
  title: string;
  description: string;
  lessons: LessonDraft[];
};

const emptyBlock = (type: Block["type"] = "text"): Block => ({
  type,
  text: "",
  url: "",
  title: "",
});
const emptyLesson = (): LessonDraft => ({
  title: "Ny lektion",
  type: "article",
  required: true,
  blocks: [emptyBlock()],
});
const emptyChapter = (): ChapterDraft => ({
  title: "Nytt kapitel",
  description: "",
  lessons: [emptyLesson()],
});

export default function CourseAdmin({
  initialCourses,
  initialVersions,
  governingDocuments,
}: {
  initialCourses: Course[];
  initialVersions: Version[];
  governingDocuments: GoverningDocument[];
}) {
  const [items, setItems] = useState(initialCourses);
  const [versions, setVersions] = useState(initialVersions);
  const [message, setMessage] = useState("");
  const [uploadingAsset, setUploadingAsset] = useState<string | null>(null);
  const [editingCourseId, setEditingCourseId] = useState<string | null>(null);
  async function updateCourseStatus(item: Course, status: "draft" | "coming_soon" | "archived") {
    const response = await fetch(`/api/admin/courses/${item.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status }) });
    if (!response.ok) return setMessage("Kursstatus kunde inte sparas.");
    setItems((current) => current.map((courseItem) => courseItem.id === item.id ? { ...courseItem, status } : courseItem));
    setMessage("Kursstatus sparad.");
  }
  const [course, setCourse] = useState({
    name: "",
    slug: "",
    shortDescription: "",
    fullDescription: "",
    category: "",
    basePriceSek: "",
    campaignPriceSek: "",
    vatRate: "25",
    validityMonths: "60",
    estimatedMinutes: "420",
    status: "draft",
    targetAudience: "",
    prerequisites: "",
    regulatoryFramework: "",
    competenceCode: "",
    tags: "Online, ID06",
    imageUrl: "",
    bannerUrl: "",
    seoTitle: "",
    seoDescription: "",
    requiresIdentityVerification: true,
    id06Enabled: true,
  });
  const [version, setVersion] = useState({ courseId: "", version: "1.0" });
  const [editingVersionId, setEditingVersionId] = useState<string | null>(null);
  const [governingDocumentIds, setGoverningDocumentIds] = useState<string[]>([]);
  const [chapters, setChapters] = useState<ChapterDraft[]>([emptyChapter()]);
  const [dragItem, setDragItem] = useState<{
    kind: "chapter" | "lesson" | "block";
    chapterIndex: number;
    lessonIndex?: number;
    itemIndex: number;
  } | null>(null);
  const [exam, setExam] = useState({
    versionId: initialVersions[0]?.id ?? "",
    questionCount: "30",
    passPercent: "80",
    timeLimitSeconds: "3600",
    maxAttempts: "3",
    cooldownSeconds: "300",
    topicRulesJson: "[]",
  });

  useEffect(() => {
    if (!exam.versionId) return;
    let cancelled = false;
    void fetch(`/api/admin/exams/${encodeURIComponent(exam.versionId)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error("exam_config_load_failed");
        return (await response.json()) as {
          config?: {
            questionCount: number;
            passPercent: number;
            timeLimitSeconds: number | null;
            maxAttempts: number;
            cooldownSeconds: number;
            questionSelectionJson?: string | null;
          } | null;
        };
      })
      .then(({ config }) => {
        if (cancelled || !config) return;
        setExam((current) => ({
          ...current,
          questionCount: String(config.questionCount),
          passPercent: String(config.passPercent),
          timeLimitSeconds: config.timeLimitSeconds === null ? "" : String(config.timeLimitSeconds),
          maxAttempts: String(config.maxAttempts),
          cooldownSeconds: String(config.cooldownSeconds),
          topicRulesJson: config.questionSelectionJson ?? "[]",
        }));
      })
      .catch(() => {
        if (!cancelled) setMessage("Provregler kunde inte laddas.");
      });
    return () => {
      cancelled = true;
    };
  }, [exam.versionId]);

  async function createCourse(event: React.FormEvent) {
    event.preventDefault();
    setMessage("");
    const response = await fetch(editingCourseId ? `/api/admin/courses/${editingCourseId}` : "/api/admin/courses", {
      method: editingCourseId ? "PATCH" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...course,
        status: editingCourseId ? undefined : course.status,
        basePriceSek: Number(course.basePriceSek),
        campaignPriceSek: course.campaignPriceSek
          ? Number(course.campaignPriceSek)
          : null,
        vatRate: Number(course.vatRate) / 100,
        validityMonths: course.validityMonths
          ? Number(course.validityMonths)
          : null,
        estimatedMinutes: Number(course.estimatedMinutes),
        ...(editingCourseId
          ? { tagsJson: JSON.stringify(course.tags.split(",").map((tag) => tag.trim()).filter(Boolean)) }
          : { tags: course.tags.split(",").map((tag) => tag.trim()).filter(Boolean) }),
      }),
    });
    const data = (await response.json()) as { course?: Course; error?: string };
    if (!response.ok || !data.course)
      return setMessage(data.error ?? "Kursen kunde inte skapas.");
    setItems((current) => editingCourseId ? current.map((item) => item.id === editingCourseId ? { ...item, ...data.course } : item) : [...current, data.course!]);
    setVersion((current) => ({ ...current, courseId: data.course!.id }));
    setEditingCourseId(null);
    setMessage(editingCourseId ? "Kursuppgifterna sparades." : "Kursen skapades som utkast.");
  }

  function editCourse(item: Course) {
    setEditingCourseId(item.id);
    setCourse({
      name: item.name,
      slug: item.slug,
      shortDescription: item.shortDescription ?? "",
      fullDescription: item.fullDescription ?? "",
      category: item.category ?? "",
      basePriceSek: String(item.priceSek),
      campaignPriceSek: item.campaignPriceSek == null ? "" : String(item.campaignPriceSek),
      vatRate: String((item.vatRate ?? 0.25) * 100),
      validityMonths: item.validityMonths == null ? "" : String(item.validityMonths),
      estimatedMinutes: String(item.estimatedMinutes ?? 0),
      status: item.status === "published" ? "draft" : item.status,
      targetAudience: item.targetAudience ?? "",
      prerequisites: item.prerequisites ?? "",
      regulatoryFramework: item.regulatoryFramework ?? "",
      competenceCode: item.competenceCode ?? "",
      tags: parseTags(item.tagsJson),
      imageUrl: item.imageUrl ?? "",
      bannerUrl: item.bannerUrl ?? "",
      seoTitle: item.seoTitle ?? "",
      seoDescription: item.seoDescription ?? "",
      requiresIdentityVerification: item.requiresIdentityVerification ?? false,
      id06Enabled: item.id06Enabled ?? false,
    });
    setMessage(`Redigerar ${item.name}.`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function cancelCourseEdit() {
    setEditingCourseId(null);
    setMessage("Redigering av kursuppgifter avslutad.");
  }

  async function createVersion(event: React.FormEvent) {
    event.preventDefault();
    setMessage("");
    const response = await fetch(
      editingVersionId
        ? `/api/admin/courses/${version.courseId}/versions/${editingVersionId}`
        : `/api/admin/courses/${version.courseId}/versions`,
      {
        method: editingVersionId ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          version: version.version,
          governingDocumentIds,
          chapters: chapters.map((chapter) => ({
            title: chapter.title,
            description: chapter.description,
            lessons: chapter.lessons.map((lesson) => ({
              title: lesson.title,
              type: lesson.type,
              required: lesson.required,
              body: { blocks: lesson.blocks },
            })),
          })),
        }),
      },
    );
    const data = (await response.json()) as {
      versionId?: string;
      error?: string;
    };
    if (!response.ok)
      return setMessage(data.error ?? "Versionen kunde inte skapas.");
    if (!editingVersionId && data.versionId)
      setVersions((current) => [
        ...current,
        {
          id: data.versionId!,
          courseId: version.courseId,
          version: version.version,
          status: "draft",
        },
      ]);
    setMessage(editingVersionId ? `Version ${version.version} uppdaterades.` : `Version ${version.version} skapades som utkast.`);
  }

  async function editVersion(item: Version) {
    setMessage("");
    const response = await fetch(`/api/admin/courses/${item.courseId}/versions/${item.id}`);
    const data = (await response.json()) as {
      version?: { version: string };
      governingDocumentIds?: string[];
      chapters?: Array<{ title: string; description: string | null; lessons: Array<{ title: string; type: LessonDraft["type"]; required: boolean; body?: { blocks?: Block[] } }> }>;
      error?: string;
    };
    if (!response.ok || !data.version) return setMessage(data.error ?? "Utkastet kunde inte laddas.");
    setEditingVersionId(item.id);
    setVersion({ courseId: item.courseId, version: data.version.version });
    setGoverningDocumentIds(data.governingDocumentIds ?? []);
    setChapters((data.chapters ?? []).map((chapter) => ({
      title: chapter.title,
      description: chapter.description ?? "",
      lessons: chapter.lessons.map((lesson) => ({
        title: lesson.title,
        type: lesson.type,
        required: lesson.required,
        blocks: lesson.body?.blocks?.length ? lesson.body.blocks : [emptyBlock()],
      })),
    })));
    setMessage(`Redigerar utkast v${data.version.version}.`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function cancelEdit() {
    setEditingVersionId(null);
    setVersion({ courseId: "", version: "1.0" });
    setGoverningDocumentIds([]);
    setChapters([emptyChapter()]);
    setMessage("Redigering avslutad.");
  }

  async function publishVersion(item: Version) {
    setMessage("");
    const response = await fetch(
      `/api/admin/courses/${item.courseId}/publish`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ versionId: item.id }),
      },
    );
    const data = (await response.json()) as { error?: string };
    if (!response.ok)
      return setMessage(data.error ?? "Versionen kunde inte publiceras.");
    setVersions((current) =>
      current.map((versionItem) =>
        versionItem.courseId === item.courseId
          ? {
              ...versionItem,
              status: versionItem.id === item.id ? "published" : "retired",
            }
          : versionItem,
      ),
    );
    setItems((current) =>
      current.map((courseItem) =>
        courseItem.id === item.courseId
          ? { ...courseItem, status: "published" }
          : courseItem,
      ),
    );
    setMessage(`Version ${item.version} är nu publicerad.`);
  }

  async function saveExam(event: React.FormEvent) {
    event.preventDefault();
    setMessage("");
    const response = await fetch(`/api/admin/exams/${exam.versionId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        questionCount: Number(exam.questionCount),
        passPercent: Number(exam.passPercent),
        timeLimitSeconds: exam.timeLimitSeconds
          ? Number(exam.timeLimitSeconds)
          : null,
        maxAttempts: Number(exam.maxAttempts),
        cooldownSeconds: Number(exam.cooldownSeconds),
        topicRulesJson: exam.topicRulesJson,
        randomizeQuestions: true,
        randomizeAnswers: true,
      }),
    });
    setMessage(
      response.ok
        ? "Examinationsinställningarna sparades."
        : "Examinationsinställningarna kunde inte sparas.",
    );
  }
  function updateChapter(index: number, update: Partial<ChapterDraft>) {
    setChapters((current) =>
      current.map((chapter, itemIndex) =>
        itemIndex === index ? { ...chapter, ...update } : chapter,
      ),
    );
  }
  function updateLesson(
    chapterIndex: number,
    lessonIndex: number,
    update: Partial<LessonDraft>,
  ) {
    setChapters((current) =>
      current.map((chapter, itemIndex) =>
        itemIndex === chapterIndex
          ? {
              ...chapter,
              lessons: chapter.lessons.map((lesson, subIndex) =>
                subIndex === lessonIndex ? { ...lesson, ...update } : lesson,
              ),
            }
          : chapter,
      ),
    );
  }
  function updateBlock(
    chapterIndex: number,
    lessonIndex: number,
    blockIndex: number,
    update: Partial<Block>,
  ) {
    setChapters((current) =>
      current.map((chapter, itemIndex) =>
        itemIndex === chapterIndex
          ? {
              ...chapter,
              lessons: chapter.lessons.map((lesson, subIndex) =>
                subIndex === lessonIndex
                  ? {
                      ...lesson,
                      blocks: lesson.blocks.map((block, index) =>
                        index === blockIndex ? { ...block, ...update } : block,
                      ),
                    }
                  : lesson,
              ),
            }
          : chapter,
      ),
    );
  }
  async function uploadBlockAsset(
    chapterIndex: number,
    lessonIndex: number,
    blockIndex: number,
    file: File,
  ) {
    const blockKey = `${chapterIndex}-${lessonIndex}-${blockIndex}`;
    setUploadingAsset(blockKey);
    const safeName = file.name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
    const form = new FormData();
    form.append("file", file);
    form.append("key", `course-assets/${version.courseId || "draft"}/${Date.now()}-${safeName}`);
    try {
      const response = await fetch("/api/admin/course-assets", {
        method: "POST",
        body: form,
      });
      const data = (await response.json().catch(() => ({}))) as {
        url?: string;
        error?: string;
      };
      if (!response.ok || !data.url) {
        setMessage(data.error ?? "Filen kunde inte laddas upp.");
        return;
      }
      updateBlock(chapterIndex, lessonIndex, blockIndex, {
        url: data.url,
        title: file.name,
      });
      setMessage(`${file.name} laddades upp och lades till i blocket.`);
    } finally {
      setUploadingAsset(null);
    }
  }
  function moveChapter(index: number, direction: -1 | 1) {
    setChapters((current) => move(current, index, direction));
  }
  function moveLesson(
    chapterIndex: number,
    lessonIndex: number,
    direction: -1 | 1,
  ) {
    setChapters((current) =>
      current.map((chapter, index) =>
        index === chapterIndex
          ? {
              ...chapter,
              lessons: move(chapter.lessons, lessonIndex, direction),
            }
          : chapter,
      ),
    );
  }
  function moveBlock(
    chapterIndex: number,
    lessonIndex: number,
    blockIndex: number,
    direction: -1 | 1,
  ) {
    setChapters((current) =>
      current.map((chapter, index) =>
        index === chapterIndex
          ? {
              ...chapter,
              lessons: chapter.lessons.map((lesson, subIndex) =>
                subIndex === lessonIndex
                  ? {
                      ...lesson,
                      blocks: move(lesson.blocks, blockIndex, direction),
                    }
                  : lesson,
              ),
            }
          : chapter,
      ),
    );
  }
  function dropItem(target: {
    kind: "chapter" | "lesson" | "block";
    chapterIndex: number;
    lessonIndex?: number;
    itemIndex: number;
  }) {
    if (!dragItem || dragItem.kind !== target.kind) return;
    setChapters((current) => {
      if (target.kind === "chapter")
        return moveTo(current, dragItem.itemIndex, target.itemIndex);
      if (
        dragItem.chapterIndex !== target.chapterIndex ||
        (target.kind === "block" && dragItem.lessonIndex !== target.lessonIndex)
      )
        return current;
      return current.map((chapter, chapterIndex) =>
        chapterIndex !== target.chapterIndex
          ? chapter
          : target.kind === "lesson"
            ? {
                ...chapter,
                lessons: moveTo(
                  chapter.lessons,
                  dragItem.itemIndex,
                  target.itemIndex,
                ),
              }
            : {
                ...chapter,
                lessons: chapter.lessons.map((lesson, lessonIndex) =>
                  lessonIndex !== target.lessonIndex
                    ? lesson
                    : {
                        ...lesson,
                        blocks: moveTo(
                          lesson.blocks,
                          dragItem.itemIndex,
                          target.itemIndex,
                        ),
                      },
                ),
              },
      );
    });
    setDragItem(null);
  }

  return (
    <section className="section course-admin-section">
      <div className="course-admin-grid">
        <form className="admin-form" onSubmit={createCourse}>
          <p className="eyebrow">{editingCourseId ? "Redigera utbildning" : "Ny utbildning"}</p>
          <h2>{editingCourseId ? "Uppdatera kurs" : "Skapa kurs"}</h2>
          {(
            [
              "name",
              "slug",
              "category",
              "basePriceSek",
              "campaignPriceSek",
              "vatRate",
              "validityMonths",
              "estimatedMinutes",
              "competenceCode",
              "tags",
              "status",
            ] as const
          ).map((field) => (
            <label key={field}>
              {field}
              <input
                required={
                  ![
                    "campaignPriceSek",
                    "validityMonths",
                    "competenceCode",
                    "tags",
                  ].includes(field)
                }
                value={course[field]}
                onChange={(event) =>
                  setCourse({ ...course, [field]: event.target.value })
                }
              />
            </label>
          ))}
          <label>
            kort beskrivning
            <input
              required
              value={course.shortDescription}
              onChange={(event) =>
                setCourse({ ...course, shortDescription: event.target.value })
              }
            />
          </label>
          <label>
            fullständig beskrivning
            <textarea
              required
              value={course.fullDescription}
              onChange={(event) =>
                setCourse({ ...course, fullDescription: event.target.value })
              }
            />
          </label>
          <label>
            Målgrupp
            <input
              value={course.targetAudience}
              onChange={(event) =>
                setCourse({ ...course, targetAudience: event.target.value })
              }
            />
          </label>
          <label>
            Förkunskaper
            <input
              value={course.prerequisites}
              onChange={(event) =>
                setCourse({ ...course, prerequisites: event.target.value })
              }
            />
          </label>
          <label>
            Styrande regelverk
            <input
              value={course.regulatoryFramework}
              onChange={(event) =>
                setCourse({
                  ...course,
                  regulatoryFramework: event.target.value,
                })
              }
            />
          </label>
          <label>
            Kursbild URL
            <input
              value={course.imageUrl}
              onChange={(event) =>
                setCourse({ ...course, imageUrl: event.target.value })
              }
            />
          </label>
          <label>
            Banner URL
            <input
              value={course.bannerUrl}
              onChange={(event) =>
                setCourse({ ...course, bannerUrl: event.target.value })
              }
            />
          </label>
          <label>
            SEO-titel
            <input
              value={course.seoTitle}
              onChange={(event) =>
                setCourse({ ...course, seoTitle: event.target.value })
              }
            />
          </label>
          <label>
            SEO-beskrivning
            <textarea
              value={course.seoDescription}
              onChange={(event) =>
                setCourse({ ...course, seoDescription: event.target.value })
              }
            />
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={course.requiresIdentityVerification}
              onChange={(event) =>
                setCourse({
                  ...course,
                  requiresIdentityVerification: event.target.checked,
                })
              }
            />{" "}
            Kräver identitetskontroll
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={course.id06Enabled}
              onChange={(event) =>
                setCourse({ ...course, id06Enabled: event.target.checked })
              }
            />{" "}
            ID06-registrering aktiv
          </label>
          <button className="button button-dark" type="submit">
            {editingCourseId ? "Spara kursuppgifter →" : "Skapa utkast →"}
          </button>
          {editingCourseId && <button className="button button-light" type="button" onClick={cancelCourseEdit}>Avbryt redigering</button>}
        </form>
        <form className="admin-form course-builder" onSubmit={createVersion}>
          <p className="eyebrow">Kursversion</p>
          <h2>Bygg innehåll</h2>
          <label>
            Kurs
            <select
              required
              value={version.courseId}
              onChange={(event) =>
                setVersion({ ...version, courseId: event.target.value })
              }
            >
              <option value="">Välj kurs</option>
              {items.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Versionsnummer
            <input
              required
              value={version.version}
              onChange={(event) =>
                setVersion({ ...version, version: event.target.value })
              }
            />
          </label>
          <label>
            Styrande dokument <span>Ctrl/Cmd-klicka för flera</span>
            <select
              multiple
              value={governingDocumentIds}
              onChange={(event) =>
                setGoverningDocumentIds(Array.from(event.target.selectedOptions, (option) => option.value))
              }
            >
              {governingDocuments.map((document) => (
                <option value={document.id} key={document.id}>
                  {document.title} · {document.version || "version saknas"}
                </option>
              ))}
            </select>
          </label>
          <div className="builder-toolbar">
            {editingVersionId && <button className="button button-light" type="button" onClick={cancelEdit}>Avbryt redigering</button>}
            <button
              className="button button-light"
              type="button"
              onClick={() =>
                setChapters((current) => [...current, emptyChapter()])
              }
            >
              + Kapitel
            </button>
          </div>
          {chapters.map((chapter, chapterIndex) => (
            <div
              className="builder-chapter"
              draggable
              onDragStart={(event) => {
                event.stopPropagation();
                setDragItem({
                  kind: "chapter",
                  chapterIndex,
                  itemIndex: chapterIndex,
                });
              }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.stopPropagation();
                dropItem({
                  kind: "chapter",
                  chapterIndex,
                  itemIndex: chapterIndex,
                });
              }}
              key={`chapter-${chapterIndex}`}
            >
              <div className="builder-heading">
                <input
                  value={chapter.title}
                  onChange={(event) =>
                    updateChapter(chapterIndex, { title: event.target.value })
                  }
                />
                <div>
                  <button
                    type="button"
                    onClick={() => moveChapter(chapterIndex, -1)}
                    disabled={!chapterIndex}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => moveChapter(chapterIndex, 1)}
                    disabled={chapterIndex === chapters.length - 1}
                  >
                    ↓
                  </button>
                </div>
              </div>
              <textarea
                placeholder="Kapitelbeskrivning"
                value={chapter.description}
                onChange={(event) =>
                  updateChapter(chapterIndex, {
                    description: event.target.value,
                  })
                }
              />
              {chapter.lessons.map((lesson, lessonIndex) => (
                <div
                  className="builder-lesson"
                  draggable
                  onDragStart={(event) => {
                    event.stopPropagation();
                    setDragItem({
                      kind: "lesson",
                      chapterIndex,
                      lessonIndex,
                      itemIndex: lessonIndex,
                    });
                  }}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.stopPropagation();
                    dropItem({
                      kind: "lesson",
                      chapterIndex,
                      itemIndex: lessonIndex,
                    });
                  }}
                  key={`lesson-${chapterIndex}-${lessonIndex}`}
                >
                  <div className="builder-heading">
                    <input
                      value={lesson.title}
                      onChange={(event) =>
                        updateLesson(chapterIndex, lessonIndex, {
                          title: event.target.value,
                        })
                      }
                    />
                    <div>
                      <button
                        type="button"
                        onClick={() =>
                          moveLesson(chapterIndex, lessonIndex, -1)
                        }
                        disabled={!lessonIndex}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        onClick={() => moveLesson(chapterIndex, lessonIndex, 1)}
                        disabled={lessonIndex === chapter.lessons.length - 1}
                      >
                        ↓
                      </button>
                    </div>
                  </div>
                  <select
                    value={lesson.type}
                    onChange={(event) =>
                      updateLesson(chapterIndex, lessonIndex, {
                        type: event.target.value as LessonDraft["type"],
                      })
                    }
                  >
                    <option value="article">Artikel</option>
                    <option value="video">Video</option>
                    <option value="image">Bild</option>
                    <option value="document">Dokument</option>
                    <option value="quiz">Quiz</option>
                    <option value="exam">Slutprov</option>
                    <option value="mixed">Blandat</option>
                  </select>
                  {lesson.blocks.map((block, blockIndex) => (
                    <div
                      className="builder-block"
                      draggable
                      onDragStart={(event) => {
                        event.stopPropagation();
                        setDragItem({
                          kind: "block",
                          chapterIndex,
                          lessonIndex,
                          itemIndex: blockIndex,
                        });
                      }}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => {
                        event.stopPropagation();
                        dropItem({
                          kind: "block",
                          chapterIndex,
                          lessonIndex,
                          itemIndex: blockIndex,
                        });
                      }}
                      key={`block-${chapterIndex}-${lessonIndex}-${blockIndex}`}
                    >
                      <div className="builder-block-top">
                        <select
                          value={block.type}
                          onChange={(event) =>
                            updateBlock(chapterIndex, lessonIndex, blockIndex, {
                              type: event.target.value as Block["type"],
                            })
                          }
                        >
                          <option value="text">Text</option>
                          <option value="richtext">Formaterad text</option>
                          <option value="heading">Rubrik</option>
                          <option value="list">Lista</option>
                          <option value="table">Tabell (JSON)</option>
                          <option value="link">Länk</option>
                          <option value="embed">Inbäddat material</option>
                          <option value="callout">Faktaruta / varning</option>
                          <option value="image">Bild</option>
                          <option value="video">Video</option>
                          <option value="document">Dokument</option>
                        </select>
                        <div>
                          <button
                            type="button"
                            onClick={() =>
                              moveBlock(
                                chapterIndex,
                                lessonIndex,
                                blockIndex,
                                -1,
                              )
                            }
                            disabled={!blockIndex}
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              moveBlock(
                                chapterIndex,
                                lessonIndex,
                                blockIndex,
                                1,
                              )
                            }
                            disabled={blockIndex === lesson.blocks.length - 1}
                          >
                            ↓
                          </button>
                        </div>
                      </div>
                      {block.type === "richtext" ? (
                        <RichTextEditor
                          value={block.text}
                          onChange={(text) => updateBlock(chapterIndex, lessonIndex, blockIndex, { text })}
                        />
                      ) : block.type === "text" ||
                      block.type === "heading" ||
                      block.type === "list" ||
                      block.type === "table" ||
                      block.type === "callout" ? (
                        <textarea
                          placeholder={
                            block.type === "callout"
                              ? "Faktaruta eller varning"
                              : block.type === "list"
                                ? "En punkt per rad"
                                : block.type === "table"
                                  ? 'Tabell som JSON, t.ex. [["Rubrik","Värde"],["A","B"]]'
                                  : block.type === "heading"
                                    ? "Rubrik"
                                    : "Lektionstext"
                          }
                          value={block.text}
                          onChange={(event) =>
                            updateBlock(chapterIndex, lessonIndex, blockIndex, {
                              text: event.target.value,
                            })
                          }
                        />
                      ) : (
                        <>
                          <input
                            placeholder="Rubrik"
                            value={block.title}
                            onChange={(event) =>
                              updateBlock(
                                chapterIndex,
                                lessonIndex,
                                blockIndex,
                                { title: event.target.value },
                              )
                            }
                          />
                          <input
                            placeholder="URL till media eller dokument"
                            value={block.url}
                            onChange={(event) =>
                              updateBlock(
                                chapterIndex,
                                lessonIndex,
                                blockIndex,
                                { url: event.target.value },
                              )
                            }
                          />
                          {(block.type === "image" ||
                            block.type === "video" ||
                            block.type === "document") && (
                            <label className="asset-upload-field">
                              <span>
                                {uploadingAsset ===
                                `${chapterIndex}-${lessonIndex}-${blockIndex}`
                                  ? "Laddar upp..."
                                  : `Ladda upp ${block.type === "video" ? "video" : block.type === "image" ? "bild" : "PDF"}`}
                              </span>
                              <input
                                type="file"
                                accept={
                                  block.type === "video"
                                    ? "video/mp4,video/webm"
                                    : block.type === "image"
                                      ? "image/jpeg,image/png,image/webp"
                                      : "application/pdf"
                                }
                                disabled={uploadingAsset !== null}
                                onChange={(event) => {
                                  const file = event.currentTarget.files?.[0];
                                  event.currentTarget.value = "";
                                  if (file)
                                    void uploadBlockAsset(
                                      chapterIndex,
                                      lessonIndex,
                                      blockIndex,
                                      file,
                                    );
                                }}
                              />
                            </label>
                          )}
                        </>
                      )}
                    </div>
                  ))}
                  <button
                    className="button button-light"
                    type="button"
                    onClick={() =>
                      updateLesson(chapterIndex, lessonIndex, {
                        blocks: [...lesson.blocks, emptyBlock()],
                      })
                    }
                  >
                    + Innehållsblock
                  </button>
                </div>
              ))}
              <button
                className="button button-light"
                type="button"
                onClick={() =>
                  updateChapter(chapterIndex, {
                    lessons: [...chapter.lessons, emptyLesson()],
                  })
                }
              >
                + Lektion
              </button>
            </div>
          ))}
          <button className="button button-dark" type="submit">
            {editingVersionId ? "Spara ändringar →" : "Spara version som utkast →"}
          </button>
        </form>
        <form className="admin-form exam-config-form" onSubmit={saveExam}>
          <p className="eyebrow">Examination</p>
          <h2>Provregler</h2>
          <label>
            Kursversion
            <select
              required
              value={exam.versionId}
              onChange={(event) =>
                setExam({ ...exam, versionId: event.target.value })
              }
            >
              <option value="">Välj version</option>
              {versions.map((item) => (
                <option value={item.id} key={item.id}>
                  {items.find((course) => course.id === item.courseId)?.name ??
                    item.courseId}{" "}
                  · v{item.version}
                </option>
              ))}
            </select>
          </label>
          <label>
            Antal frågor
            <input
              type="number"
              min="1"
              max="200"
              required
              value={exam.questionCount}
              onChange={(event) =>
                setExam({ ...exam, questionCount: event.target.value })
              }
            />
          </label>
          <label>
            Godkäntgräns (%)
            <input
              type="number"
              min="1"
              max="100"
              required
              value={exam.passPercent}
              onChange={(event) =>
                setExam({ ...exam, passPercent: event.target.value })
              }
            />
          </label>
          <label>
            Tidsgräns (sekunder)
            <input
              type="number"
              min="60"
              value={exam.timeLimitSeconds}
              onChange={(event) =>
                setExam({ ...exam, timeLimitSeconds: event.target.value })
              }
            />
          </label>
          <label>
            Max antal försök
            <input
              type="number"
              min="1"
              max="20"
              required
              value={exam.maxAttempts}
              onChange={(event) =>
                setExam({ ...exam, maxAttempts: event.target.value })
              }
            />
          </label>
          <label>
            Väntetid mellan försök (sekunder)
            <input
              type="number"
              min="0"
              required
              value={exam.cooldownSeconds}
              onChange={(event) =>
                setExam({ ...exam, cooldownSeconds: event.target.value })
              }
            />
          </label>
          <label>
            Ämnesstyrt frågeurval (JSON)
            <textarea value={exam.topicRulesJson} onChange={(event) => setExam({ ...exam, topicRulesJson: event.target.value })} placeholder='[{"topic":"Riskbedömning","count":5}]' />
          </label>
          <button className="button button-dark" type="submit">
            Spara provregler →
          </button>
        </form>
      </div>
      {message && (
        <p className="admin-message" role="status">
          {message}
        </p>
      )}
      <div className="course-admin-list">
        <p className="eyebrow">Kurser</p>
        {items.map((item) => (
          <div key={item.id}>
            <strong>{item.name}</strong>
            <span>
              <select aria-label={`Status för ${item.name}`} value={item.status} disabled={item.status === "published"} onChange={(event) => void updateCourseStatus(item, event.target.value as "draft" | "coming_soon" | "archived")}><option value="draft">Utkast</option><option value="coming_soon">Coming soon</option><option value="published">Publicerad</option><option value="archived">Arkiverad</option></select> · {item.priceSek} kr <button className="button button-light" type="button" onClick={() => editCourse(item)}>Redigera</button>
            </span>
          </div>
        ))}
      </div>
      <div className="course-admin-list">
        <p className="eyebrow">Versioner</p>
        {versions.map((item) => (
          <div key={item.id}>
            <strong>
              {items.find((courseItem) => courseItem.id === item.courseId)
                ?.name ?? item.courseId}{" "}
              · v{item.version}
            </strong>
            <span>
              {item.status}{" "}
              {item.status === "draft" && (
                <>
                  <button className="button button-light" type="button" onClick={() => void editVersion(item)}>Redigera</button>
                  <button className="button button-light" type="button" onClick={() => void publishVersion(item)}>Publicera</button>
                </>
              )}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function move<T>(items: T[], index: number, direction: -1 | 1) {
  const target = index + direction;
  if (target < 0 || target >= items.length) return items;
  const copy = [...items];
  [copy[index], copy[target]] = [copy[target], copy[index]];
  return copy;
}

function parseTags(value: string | undefined) {
  if (!value) return "";
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((tag): tag is string => typeof tag === "string").join(", ") : "";
  } catch {
    return "";
  }
}

function RichTextEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  function insert(prefix: string, suffix = prefix) {
    const textarea = ref.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = value.slice(start, end) || "text";
    onChange(`${value.slice(0, start)}${prefix}${selected}${suffix}${value.slice(end)}`);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(start + prefix.length, start + prefix.length + selected.length);
    });
  }
  return <div className="richtext-editor"><div className="richtext-toolbar" role="toolbar" aria-label="Formatering"><button type="button" aria-label="Fetstil" onClick={() => insert("**")}>B</button><button type="button" aria-label="Kursiv" onClick={() => insert("*")}>I</button><button type="button" aria-label="Rubrik" onClick={() => insert("### ", "")}>H</button><button type="button" aria-label="Punktlista" onClick={() => insert("- ", "")}>•</button><button type="button" aria-label="Länk" onClick={() => insert("[", "](https://) ")}>↗</button></div><textarea ref={ref} value={value} placeholder="Formaterad text" onChange={(event) => onChange(event.target.value)} /></div>;
}

function moveTo<T>(items: T[], from: number, to: number) {
  if (
    from === to ||
    from < 0 ||
    to < 0 ||
    from >= items.length ||
    to >= items.length
  )
    return items;
  const copy = [...items];
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item);
  return copy;
}
