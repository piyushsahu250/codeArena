// Shared "fetch a file from the API and save it" helper. Handles the details every hand-rolled copy
// got wrong at least once: the anchor must be attached to the DOM for Firefox/Safari to honour
// click(), the object URL must outlive the click (revoking synchronously can cancel the download),
// and when the server answers with an error the body is a Blob -- its JSON message has to be read
// out of that Blob or the user just sees "failed" with no reason.
import api from "../api";

export async function errorMessageFrom(err, fallback = "Download failed") {
  const data = err?.response?.data;
  if (data instanceof Blob) {
    try { return JSON.parse(await data.text()).error || fallback; } catch { return fallback; }
  }
  return data?.error || err?.message || fallback;
}

export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1500);
}

// Resolves to the saved filename. Throws an Error whose message is already user-presentable.
export async function downloadFromApi(path, { params, fallbackName = "download" } = {}) {
  let res;
  try {
    res = await api.get(path, { params, responseType: "blob" });
  } catch (err) {
    throw new Error(await errorMessageFrom(err));
  }
  const cd = res.headers?.["content-disposition"] || "";
  const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd);
  const filename = m ? decodeURIComponent(m[1]) : fallbackName;
  saveBlob(res.data, filename);
  return filename;
}
