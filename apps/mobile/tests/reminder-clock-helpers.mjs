/** Exercise the continuous dial via real pointer events, not onChange injection. */
export async function tapClock(page, value, { minute = false, inner = false } = {}) {
  const clock = page.getByTestId("reminder-clock");
  const bounds = await clock.boundingBox();
  const angle = value / (minute ? 60 : 12) * Math.PI * 2;
  const radius = inner ? 68 : 104;
  await clock.click({ position: { x: (128 + Math.sin(angle) * radius) / 256 * bounds.width,
    y: (128 - Math.cos(angle) * radius) / 256 * bounds.height } });
}

export async function chooseClockTime(page, hour, minute, hour12) {
  await page.getByRole("radiogroup", { name: "Reminder date or time", exact: true }).getByRole("radio", { name: "Time", exact: true }).click();
  await page.getByRole("button", { name: "Select hour", exact: true }).click();
  await tapClock(page, hour % 12, { inner: !hour12 && (hour === 0 || hour > 12) });
  await page.getByRole("slider", { name: "Reminder minute", exact: true }).waitFor();
  await tapClock(page, minute, { minute: true });
  if (hour12) await page.getByRole("radiogroup", { name: "Day period", exact: true }).getByRole("radio", { name: hour >= 12 ? "PM" : "AM", exact: true }).click();
}
