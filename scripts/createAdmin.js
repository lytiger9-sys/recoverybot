import "dotenv/config";
import mongoose from "mongoose";
import { Admin } from "../src/models/Admin.js";
import { connectDatabase } from "../src/database/connectDatabase.js";
import { hashPassword } from "../src/security/passwords.js";

function ask(promptText, hidden = false) {
  return new Promise((resolve, reject) => {
    process.stdout.write(promptText);
    if (hidden && !process.stdin.isTTY) {
      reject(new Error("숨김 비밀번호 입력은 터미널에서 실행해야 합니다."));
      return;
    }
    if (hidden) process.stdin.setRawMode(true);
    process.stdin.setEncoding("utf8");
    process.stdin.resume();
    let value = "";
    const finish = (error) => {
      process.stdin.removeListener("data", onData);
      process.stdin.pause();
      if (hidden) {
        process.stdin.setRawMode(false);
        process.stdout.write("\n");
      }
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk) => {
      for (const character of chunk) {
        if (character === "\u0003") return finish(new Error("취소했습니다."));
        if (character === "\r" || character === "\n") return finish();
        if (character === "\u007f" || character === "\b") {
          const characters = [...value];
          if (characters.length) {
            characters.pop();
            value = characters.join("");
            process.stdout.write("\b \b");
          }
        } else {
          value += character;
          process.stdout.write(hidden ? "*" : character);
        }
      }
    };
    process.stdin.on("data", onData);
  });
}

try {
  const username = (await ask("관리자 아이디: ")).trim();
  const password = await ask("관리자 비밀번호(12자 이상, 입력 내용은 *로 표시): ", true);
  if (username.length < 3 || username.length > 120) throw new Error("아이디는 3~120자여야 합니다.");
  if (password.length < 12) throw new Error("비밀번호는 12자 이상이어야 합니다.");
  await connectDatabase(process.env.MONGODB_URI);
  if (await Admin.exists({ username })) throw new Error("이미 등록된 관리자 아이디입니다.");
  await Admin.create({ username, passwordHash: await hashPassword(password) });
  console.log("관리자 계정을 생성했습니다.");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect().catch(() => {});
}

