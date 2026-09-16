/**
 * C-UPLOAD — ملف واحد/متعدد، سحب وإفلات مع بديل زر (زر الرفع قابل للتركيز دائماً)، من الكاميرا.
 * الحالات: ready, loading (نسبة), validation_error (نوع/حجم), offline (يُجدول للرفع لاحقاً),
 * server_error. النسبة تُعلن دورياً؛ الخطأ يذكر النوع والحجم المسموحين؛ Delete يحذف ملفاً محدداً.
 */
import { Camera, Trash2, UploadCloud } from "lucide-react";
import { type ChangeEvent, type DragEvent, useId, useRef, useState } from "react";

import { Button } from "./Button";

export interface UploadItem {
  readonly id: string;
  readonly name: string;
  readonly sizeLabel: string;
  readonly progress?: number | undefined;
  readonly error?: string | undefined;
  /** بلا اتصال: مُجدوَل للرفع عند العودة. */
  readonly queued?: boolean | undefined;
}

export interface UploadProps {
  readonly label: string;
  readonly accept: string;
  /** نص الأنواع والحجم المسموحين — يظهر دائماً ويُستعمل في رسالة الخطأ. */
  readonly constraintsText: string;
  readonly multiple?: boolean | undefined;
  readonly camera?: boolean | undefined;
  readonly items: readonly UploadItem[];
  readonly onFiles: (files: File[]) => void;
  readonly onRemove: (id: string) => void;
  readonly error?: string | undefined;
}

export function Upload({
  label,
  accept,
  constraintsText,
  multiple,
  camera,
  items,
  onFiles,
  onRemove,
  error,
}: UploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const id = useId();
  const take = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? [...e.target.files] : [];
    if (files.length) onFiles(files);
    e.target.value = "";
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const files = [...e.dataTransfer.files];
    if (files.length) onFiles(files);
  };
  return (
    <div className="c-upload">
      <p id={`${id}-label`} className="c-field__label">
        {label}
      </p>
      <div
        className={`c-upload__zone${dragging ? " c-upload__zone--over" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        aria-labelledby={`${id}-label`}
        role="group"
      >
        <UploadCloud size={24} aria-hidden="true" />
        <p className="c-upload__text">اسحب الملف هنا أو</p>
        <div className="c-upload__actions">
          <Button variant="secondary" onClick={() => inputRef.current?.click()}>
            اختر ملفاً
          </Button>
          {camera ? (
            <Button
              variant="secondary"
              icon={<Camera size={18} />}
              onClick={() => cameraRef.current?.click()}
            >
              من الكاميرا
            </Button>
          ) : null}
        </div>
        <p id={`${id}-constraints`} className="c-field__hint">
          {constraintsText}
        </p>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple={multiple}
          className="visually-hidden"
          aria-label={label}
          aria-describedby={`${id}-constraints`}
          onChange={take}
        />
        {camera ? (
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="visually-hidden"
            aria-label={`${label} — من الكاميرا`}
            onChange={take}
          />
        ) : null}
      </div>
      {error ? (
        <p className="c-field__error" role="alert">
          {error}
        </p>
      ) : null}
      {items.length > 0 ? (
        <ul className="c-upload__list" aria-label="الملفات">
          {items.map((it) => (
            <li key={it.id} className="c-upload__item">
              <span className="c-upload__name">{it.name}</span>
              <span className="c-upload__size sting-mono">{it.sizeLabel}</span>
              {it.progress !== undefined && it.progress < 100 ? (
                <progress
                  className="c-upload__progress"
                  value={it.progress}
                  max={100}
                  aria-label={`رفع ${it.name}`}
                >
                  {it.progress}٪
                </progress>
              ) : null}
              {it.queued ? (
                <span className="c-field__hint">مُجدوَل للرفع عند عودة الاتصال</span>
              ) : null}
              {it.error ? (
                <span className="c-field__error" role="alert">
                  {it.error}
                </span>
              ) : null}
              <Button
                variant="icon"
                iconLabel={`حذف ${it.name}`}
                icon={<Trash2 size={18} />}
                onClick={() => onRemove(it.id)}
                onKeyDown={(e) => {
                  // Delete يحذف الملف المحدد (23-Handoff)
                  if (e.key === "Delete") {
                    e.preventDefault();
                    onRemove(it.id);
                  }
                }}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
