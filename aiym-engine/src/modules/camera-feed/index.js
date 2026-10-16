// Модуль «Веб-камера»: только добывает видеопоток и отдаёт его правой панели.
// «Матричный» фильтр — часть движка (ctx.ui.viewport), модули зрения будут читать тот же кадр.
export default function create() {
  let stream = null, video = null;

  return {
    async start(ctx) {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Камера недоступна (нужен https или localhost)');
      const deviceId = ctx.config.get('deviceId', undefined);
      stream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: deviceId ? { exact: deviceId } : undefined, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
        audio: false,
      });
      video = Object.assign(document.createElement('video'), { srcObject: stream, muted: true, playsInline: true });
      await video.play();
      ctx.ui.viewport.setSource(video, true);
      const announce = () => ctx.bus.emit('camera.ready', { video, width: video.videoWidth, height: video.videoHeight });
      announce();
      ctx.bus.on('camera.request', announce);          // «Зрение» и другие модули могут запросить поток позже
      ctx.defer(() => { ctx.ui.viewport.setSource(null); ctx.bus.emit('camera.stopped', {}); });
      ctx.log(`камера ${video.videoWidth}×${video.videoHeight}`);
    },
    async stop() {
      stream?.getTracks().forEach((t) => t.stop());
      video?.pause(); stream = video = null;
    },
  };
}
