const accountDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kuala_Lumpur", year: "numeric", month: "2-digit", day: "2-digit",
});

export function demandMetaReportingDate(date: Date): string {
  return accountDate.format(date);
}
