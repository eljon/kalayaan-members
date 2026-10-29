/**
 * The app opens with no connection, from the copy saved on the device.
 *
 * Visits the app once online (which saves the copy), cuts the network, and
 * reloads: the roll and the members must still be there, with a notice
 * saying it is the saved copy and from when. A change made while offline
 * must reach the server once the connection is back. And "Remove saved
 * data from this device" must actually remove it.
 */

const h = require("./harness");

h.seed({ lists: [] });
h.run("offline", async (page, t) => {
  const ctx = page.context();
  await page.evaluate(() => navigator.serviceWorker.ready);
  // The first visit installs the worker; the second is the one it serves,
  // and that is when the data is saved.
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector("#roll-body .roll-row");
  t.ok(await page.evaluate(() => !!navigator.serviceWorker.controller), "the offline copy is in charge of the page");
  await h.goTab(page, "members");
  const onlineRows = await page.$$eval("#mem-table tbody tr", (n) => n.length);
  await h.goTab(page, "attendance");
  t.ok(await page.isHidden("#offline-bar"), "online, there is no offline notice");

  // ---- no connection ------------------------------------------------------
  await ctx.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("#roll-body .roll-row", { timeout: 20000 });
  t.ok(true, "with no connection, the app still opens and the roll is there");
  await page.waitForSelector("#offline-bar:not([hidden])");
  const said = await page.textContent("#offline-bar");
  t.ok(/^Offline — showing what this device saved on /.test(said), `and it says it is the saved copy (${said.slice(0, 70)}…)`);
  t.ok(await page.$eval("#refresh", (b) => b.disabled), "Refresh is switched off until the connection is back");
  await h.goTab(page, "members");
  t.eq(await page.$$eval("#mem-table tbody tr", (n) => n.length), onlineRows, "the Members tab works offline too");

  // A change made offline: start an action list.
  await h.goTab(page, "actions", 600).catch(() => {});
  await page.click("#al-none-new");
  await page.waitForTimeout(600);
  await page.fill("#al-name", "Made on the bus");
  await page.waitForTimeout(600);
  t.ok((h.readPrefs().actionLists || []).length === 0, "offline, the change has not reached the server");

  // ---- back online --------------------------------------------------------
  await ctx.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await page.waitForTimeout(1500);
  const names = (h.readPrefs().actionLists || []).map((l) => l.name);
  t.ok(names.includes("Made on the bus"), `back online, it is sent to the server (${JSON.stringify(names)})`);
  t.ok(await page.isHidden("#offline-bar"), "and the offline notice goes away");

  // ---- removing the saved copy -------------------------------------------
  await page.click("#settings-btn");
  page.once("dialog", (d) => d.accept());
  await page.click("#clear-device-btn");
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1500);
  const left = await page.evaluate(async () => ({
    caches: (await caches.keys()).length,
    keys: Object.keys(localStorage).filter((k) => k.startsWith("kalayaan:") && k !== "kalayaan:settings" && k !== "kalayaan:sort").length,
  }));
  // The page re-registers its worker as it reloads; what matters is that the
  // member data saved before is gone.
  const hasOldData = await page.evaluate(async () => {
    for (const k of await caches.keys()) {
      const c = await caches.open(k);
      if (await c.match(location.origin + "/api/members")) return true;
    }
    return false;
  });
  t.ok(!hasOldData, `"Remove saved data" removes the saved member records (${JSON.stringify(left)})`);
}, { viewport: { width: 1400, height: 900 }, serviceWorkers: "allow" });
