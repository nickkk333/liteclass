import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";

const db = new DatabaseSync("data/liteclass.db");
const out = {};
for (const id of [1, 2, 3, 4]) {
  out[id] = db.prepare("SELECT title,duration FROM materials WHERE course_id=? ORDER BY sort_order").all(id);
}
fs.writeFileSync("server/seed-tracks.json", JSON.stringify(out, null, 2), "utf8");
db.prepare("UPDATE materials SET title = REPLACE(title,'.wav','') WHERE course_id = 1").run();
db.prepare("UPDATE exam_questions SET answer = '0,1,2,3' WHERE type = 'multiple'").run();
console.log("ok", out[1].length, out[2].length, out[3].length, out[4].length);
