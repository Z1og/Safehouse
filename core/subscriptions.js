async function unsubscribeAndUninstall({ id, workshop, downloads, library, trash, localizations }) {
  // Failure to unsubscribe must leave installed files untouched.
  const result = await workshop.unsubscribe(id);
  await downloads.stopWorkshop(result.id);
  try {
    const retained = localizations ? localizations.retained(result.id) : [];
    const removed = await library.uninstallWorkshop(result.id, trash);
    return { ...result, removed: removed.removed, preserved: retained.length > 0, retained: retained.length };
  } catch (error) {
    throw new Error(`已取消订阅，但本地卸载未完成：${error.message}。请在模组管理中重试卸载。`);
  }
}
module.exports = { unsubscribeAndUninstall };
