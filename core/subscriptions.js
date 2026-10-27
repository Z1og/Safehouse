async function unsubscribeAndUninstall({ id, workshop, downloads, library, trash, preserveLocal = false }) {
  // Failure to unsubscribe must leave installed files untouched.
  const result = await workshop.unsubscribe(id);
  await downloads.stopWorkshop(result.id);
  if (preserveLocal) return { ...result, preserved: true, removed: [] };
  try {
    const removed = await library.uninstallWorkshop(result.id, trash);
    return { ...result, removed: removed.removed };
  } catch (error) {
    throw new Error(`已取消订阅，但本地卸载未完成：${error.message}。请在模组管理中重试卸载。`);
  }
}
module.exports = { unsubscribeAndUninstall };
