import React from "react";
import { textError, TEXT_LIMIT } from "../model.js";
export default function Field({ label, value, onChange, rows = 3, ...props }) {
  const error = textError(value, "此字段", TEXT_LIMIT);
  return (
    <label className="field">
      <span>{label}</span>
      <textarea
        aria-label={label}
        aria-invalid={!!error}
        value={value}
        rows={rows}
        onChange={(e) => onChange(e.target.value)}
        {...props}
      />
      {error && (
        <small className="validation-error" role="alert">
          {error}
        </small>
      )}
    </label>
  );
}
