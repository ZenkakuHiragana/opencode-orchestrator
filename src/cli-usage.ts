import { t } from "./i18n/messages.js";

export function printListUsage() {
  console.error(t("cli.list.usage"));
}

export function printExecUsage() {
  console.error(t("cli.exec.usage"));
}

export function printLoopUsage() {
  console.error(t("cli.loop.usage"));
}

export function printRunUsage() {
  console.error(t("cli.run.usage"));
}

export function printResumeUsage() {
  console.error(t("cli.resume.usage"));
}

export function printStatusUsage() {
  console.error(t("cli.status.usage"));
}

export function printDoctorUsage() {
  console.error(t("cli.doctor.usage"));
}

export function printFixUsage() {
  console.error(t("cli.fix.usage"));
}

export function printCompletionUsage() {
  console.error(t("cli.completion.usage"));
}
