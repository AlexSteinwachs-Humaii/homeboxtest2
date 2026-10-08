import type { MailerConfig } from "../config.ts";
import type { MailSender } from "./users.ts";

export function mailerFromConfig(config: MailerConfig): MailSender {
  const ready = Boolean(config.host && config.port && config.username && config.password && config.from);
  return {
    ready,
    send: async (message) => {
      if (!ready) throw new Error("mailer is not configured");
      await sendSmtp(config, message);
    },
  };
}

async function sendSmtp(
  config: MailerConfig,
  message: { toName: string; toEmail: string; subject: string; body: string },
): Promise<void> {
  const { connect } = await import("node:net");
  const socket = connect({ host: config.host, port: config.port });
  const chunks: string[] = [];
  const reader = new Promise<void>((resolve, reject) => {
    socket.setEncoding("utf8");
    socket.on("data", (data: string) => chunks.push(data));
    socket.on("error", reject);
    socket.on("close", () => resolve());
  });
  await once(socket, "connect");
  const write = (line: string) => {
    socket.write(line + "\r\n");
  };
  await readReply(socket, chunks);
  write(`EHLO homebox`);
  await readReply(socket, chunks);
  write("AUTH LOGIN");
  await readReply(socket, chunks);
  write(Buffer.from(config.username).toString("base64"));
  await readReply(socket, chunks);
  write(Buffer.from(config.password).toString("base64"));
  await readReply(socket, chunks);
  write(`MAIL FROM:<${config.from}>`);
  await readReply(socket, chunks);
  write(`RCPT TO:<${message.toEmail}>`);
  await readReply(socket, chunks);
  write("DATA");
  await readReply(socket, chunks);
  const payload = [
    `From: Homebox <${config.from}>`,
    `To: ${message.toName} <${message.toEmail}>`,
    `Subject: ${message.subject}`,
    "MIME-Version: 1.0",
    'Content-Type: text/html; charset="utf-8"',
    "",
    message.body,
    ".",
  ].join("\r\n");
  write(payload);
  await readReply(socket, chunks);
  write("QUIT");
  socket.end();
  await reader;
}

function once(socket: import("node:net").Socket, event: string): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once(event, () => resolve());
    socket.once("error", reject);
  });
}

function readReply(socket: import("node:net").Socket, chunks: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const take = () => {
      const text = chunks.join("");
      const lines = text.split("\r\n").filter(Boolean);
      const last = lines.at(-1);
      if (last && /^\d{3} /.test(last)) {
        chunks.length = 0;
        if (last.startsWith("5") || last.startsWith("4")) reject(new Error(last));
        else resolve(text);
        return true;
      }
      return false;
    };
    if (take()) return;
    const onData = () => {
      if (take()) cleanup();
    };
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };
    const cleanup = () => {
      socket.off("data", onData);
      socket.off("error", onError);
    };
    socket.on("data", onData);
    socket.on("error", onError);
  });
}
