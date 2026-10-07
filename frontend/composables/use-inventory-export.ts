import { ref } from "vue";

/** Keep the request and download lifecycle together so repeated activations are harmless. */
export function useInventoryExport(request: () => Promise<Blob>, onError: () => void) {
  const exporting = ref(false);

  async function download() {
    if (exporting.value) return;
    exporting.value = true;
    try {
      const blob = await request();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      try {
        link.href = url;
        link.download = "homebox-dashboard-inventory.csv";
        document.body.appendChild(link);
        link.click();
      } finally {
        link.remove();
        // Allow the browser to start consuming the URL before releasing it.
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch {
      onError();
    } finally {
      exporting.value = false;
    }
  }

  return { exporting, download };
}
