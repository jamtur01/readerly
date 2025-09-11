import { createApp } from "./app";
import { env } from "./env";

const app = createApp();
app.listen(env.BACKEND_PORT, () => {
  console.log(`Readerly API listening on http://localhost:${env.BACKEND_PORT}`);
});