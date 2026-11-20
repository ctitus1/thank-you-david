// The shared HTML reads its embedded snapshot instead of calling a server.
(() => {
  const payload = JSON.parse(document.getElementById("wic-data").textContent);
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const settings = payload.settings;
  const safeJSON = (value) =>
    JSON.stringify(value).replace(
      /[<>&\u2028\u2029]/g,
      (character) =>
        "\\u" + character.charCodeAt(0).toString(16).padStart(4, "0")
    );

  window.WIC_PORTABLE = {
    exportedAt: payload.exported_at,
    initialView: payload.initial_view || null,
    async api(path, options = {}) {
      const method = options.method || "GET";
      if (path === "/sources" && method === "GET")
        return clone(payload.sources);
      const source = path.match(/^\/sources\/([a-f0-9]+)$/);
      if (source && method === "GET") {
        const metadata = payload.sources.find((item) => item.id === source[1]);
        if (!metadata)
          throw Error("This source is not included in the shared file.");
        return {
          metadata: clone(metadata),
          records: clone(payload.records[source[1]]),
        };
      }
      const setting = path.match(/^\/settings\/(watchlist|views|weights)$/);
      if (setting) {
        if (method === "POST") settings[setting[1]] = JSON.parse(options.body);
        else if (method !== "GET")
          throw Error("This action is not supported in a shared snapshot.");
        return method === "GET"
          ? clone(settings[setting[1]] || [])
          : { ok: true };
      }
      throw Error(
        "Imports and live refresh require the local server app. This file contains a fixed data snapshot."
      );
    },
    saveCopy(view) {
      payload.initial_view = clone(view);
      payload.settings = settings;
      payload.saved_at = new Date().toISOString();
      const copy = document.documentElement.cloneNode(true);
      copy.querySelector("#wic-data").textContent = safeJSON(payload);
      copy.querySelector("#app").innerHTML =
        '<div class="loading">Opening the shared snapshot…</div>';
      const dialog = copy.querySelector("#dialog");
      dialog.removeAttribute("open");
      dialog.innerHTML = "";
      const toast = copy.querySelector("#toast");
      toast.textContent = "";
      toast.classList.remove("visible");
      const url = URL.createObjectURL(
        new Blob(["<!doctype html>\n" + copy.outerHTML], {
          type: "text/html;charset=utf-8",
        })
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = "thank-you-david.html";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
  };
})();
