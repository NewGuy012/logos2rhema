import { Hono } from "hono";

export interface WorkerBindings {
	BIBLE_BRAIN_API_KEY?: string;
	AUDIO_BASE_URL?: string;
}

const app = new Hono<{ Bindings: WorkerBindings }>();

app.get("/api/", (c) => c.json({ name: "Logos" }));

export default app;
