import React from "react";
export default function Field({ label, value, onChange, rows = 3, ...props }) {
  return (
    <label className="field">
      <span>{label}</span>
      <textarea
        value={value}
        rows={rows}
        onChange={(e) => onChange(e.target.value)}
        {...props}
      />
    </label>
  );
}
