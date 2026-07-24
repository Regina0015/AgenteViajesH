import { useEffect, useRef, useState } from 'react';

export default function CameraCapture({ onImage }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const fileRef = useRef(null);
  const [on, setOn] = useState(false);
  const [err, setErr] = useState(null);
  const [drag, setDrag] = useState(false);

  async function start() {
    setErr(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
      streamRef.current = stream;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      setOn(true);
    } catch (e) {
      setErr(
        e.name === 'NotAllowedError'
          ? 'Permiso de cámara denegado. Actívalo en el navegador o sube la foto como archivo.'
          : 'No pude abrir la cámara: ' + e.message
      );
    }
  }

  function stop() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setOn(false);
  }

  function shoot() {
    const v = videoRef.current;
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    c.toBlob(
      (blob) => {
        onImage(blob, URL.createObjectURL(blob));
        stop();
      },
      'image/jpeg',
      0.92
    );
  }

  function fromFile(file) {
    if (!file || !file.type.startsWith('image/')) {
      setErr('Solo imágenes (jpg, png, webp).');
      return;
    }
    onImage(file, URL.createObjectURL(file));
  }

  useEffect(() => stop, []);

  return (
    <div>
      {err && <div className="err">{err}</div>}

      {on ? (
        <div className="camera-box">
          <video ref={videoRef} playsInline muted />
          <div className="camera-controls">
            <button className="shutter" title="Tomar foto" onClick={shoot} />
            <button className="btn ghost small" onClick={stop}>Cancelar</button>
          </div>
        </div>
      ) : (
        <>
          <video ref={videoRef} style={{ display: 'none' }} playsInline muted />
          <div style={{ display: 'grid', gap: 10 }}>
            <button className="btn" onClick={start}>📷 Abrir cámara</button>
            <div
              className={'dropzone' + (drag ? ' drag' : '')}
              onClick={() => fileRef.current.click()}
              onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => { e.preventDefault(); setDrag(false); fromFile(e.dataTransfer.files[0]); }}
            >
              …o arrastra aquí la foto del ticket / haz clic para elegir archivo
            </div>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => fromFile(e.target.files[0])} />
          </div>
        </>
      )}
    </div>
  );
}
