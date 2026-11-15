// Área de aulas: o conteúdo (módulos + aulas) é UM só pro sistema inteiro,
// editado pelo dono (platform admin) e lido por todas as organizações. Fica
// guardado em app_config da organização do dono, sem tabela nova. O progresso
// ("aula concluída") é de cada usuário, em app_config da organização dele.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { appConfig } from "@/db/schema";
import { requireOrgContext } from "@/server/session";
import { TRIAD_COMPANY_ORG_ID } from "@/lib/feature-flags";

export interface CourseLesson {
  id: string;
  title: string;
  url: string;
  description: string;
}
export interface CourseModule {
  id: string;
  title: string;
  lessons: CourseLesson[];
}
export interface CourseData {
  modules: CourseModule[];
}
export interface CoursePayload {
  course: CourseData;
  completed: string[];
  canEdit: boolean;
}

const CONTENT_KEY = "course_content";
const progressKey = (userId: string) => `course_progress:${userId}`;

const courseSchema = z.object({
  modules: z.array(
    z.object({
      id: z.string().min(1),
      title: z.string().max(200),
      lessons: z.array(
        z.object({
          id: z.string().min(1),
          title: z.string().max(200),
          url: z.string().max(1000),
          description: z.string().max(5000),
        })
      ),
    })
  ),
});

async function readConfig(organizationId: string, key: string): Promise<string | null> {
  const rows = await db
    .select({ value: appConfig.value })
    .from(appConfig)
    .where(and(eq(appConfig.organizationId, organizationId), eq(appConfig.key, key)))
    .limit(1);
  return rows[0]?.value ?? null;
}

async function writeConfig(organizationId: string, key: string, value: string) {
  await db
    .insert(appConfig)
    .values({ organizationId, key, value })
    .onConflictDoUpdate({ target: [appConfig.organizationId, appConfig.key], set: { value } });
}

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

const _fetchCourse = createServerFn({ method: "GET" }).handler(async (): Promise<CoursePayload> => {
  const { organizationId, userId, isPlatformAdmin } = await requireOrgContext();
  const course = parseJson<CourseData>(await readConfig(TRIAD_COMPANY_ORG_ID, CONTENT_KEY), { modules: [] });
  const completed = parseJson<string[]>(await readConfig(organizationId, progressKey(userId)), []);
  return { course, completed, canEdit: isPlatformAdmin };
});

export async function fetchCourse(): Promise<CoursePayload> {
  return _fetchCourse();
}

const _saveCourse = createServerFn({ method: "POST" })
  .inputValidator(courseSchema)
  .handler(async ({ data }): Promise<void> => {
    const { isPlatformAdmin } = await requireOrgContext();
    if (!isPlatformAdmin) throw new Error("Só o administrador da plataforma edita as aulas.");
    await writeConfig(TRIAD_COMPANY_ORG_ID, CONTENT_KEY, JSON.stringify(data));
  });

export async function saveCourse(course: CourseData): Promise<void> {
  await _saveCourse({ data: course });
}

const _setLessonDone = createServerFn({ method: "POST" })
  .inputValidator(z.object({ lessonId: z.string().min(1), done: z.boolean() }))
  .handler(async ({ data }): Promise<string[]> => {
    const { organizationId, userId } = await requireOrgContext();
    const current = parseJson<string[]>(await readConfig(organizationId, progressKey(userId)), []);
    const next = data.done ? Array.from(new Set([...current, data.lessonId])) : current.filter((id) => id !== data.lessonId);
    await writeConfig(organizationId, progressKey(userId), JSON.stringify(next));
    return next;
  });

export async function setLessonDone(lessonId: string, done: boolean): Promise<string[]> {
  return _setLessonDone({ data: { lessonId, done } });
}
