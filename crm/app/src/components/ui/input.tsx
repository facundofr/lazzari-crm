"use client";

import { cn } from "@/lib/utils";
import { forwardRef } from "react";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, hint, className, id, ...props }, ref) => {
    const inputId = id || (label ? label.toLowerCase().replace(/\s+/g, "-") : undefined);

    return (
      <div className="space-y-1.5">
        {label && (
          <label htmlFor={inputId} className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={cn(
            "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400",
            "focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-100",
            "dark:border-zinc-600 dark:bg-zinc-800 dark:text-white dark:focus:border-orange-500 dark:focus:ring-orange-900/30",
            "disabled:cursor-not-allowed disabled:opacity-50",
            error && "border-red-400 focus:border-red-400 focus:ring-red-100 dark:border-red-500",
            className
          )}
          {...props}
        />
        {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
        {hint && !error && <p className="text-xs text-zinc-500">{hint}</p>}
      </div>
    );
  }
);
Input.displayName = "Input";

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  options: { value: string; label: string; group?: string }[];
  placeholder?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, options, placeholder, className, id, ...props }, ref) => {
    const selectId = id || (label ? label.toLowerCase().replace(/\s+/g, "-") : undefined);

    // Group options if any have a group property
    const groups = options.reduce<Record<string, typeof options>>((acc, opt) => {
      const group = opt.group || "__default__";
      if (!acc[group]) acc[group] = [];
      acc[group].push(opt);
      return acc;
    }, {});
    const hasGroups = Object.keys(groups).length > 1 || !groups["__default__"];

    return (
      <div className="space-y-1.5">
        {label && (
          <label htmlFor={selectId} className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            {label}
          </label>
        )}
        <select
          ref={ref}
          id={selectId}
          className={cn(
            "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900",
            "focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-100",
            "dark:border-zinc-600 dark:bg-zinc-800 dark:text-white dark:focus:border-orange-500 dark:focus:ring-orange-900/30",
            "disabled:cursor-not-allowed disabled:opacity-50",
            error && "border-red-400 focus:border-red-400 focus:ring-red-100 dark:border-red-500",
            className
          )}
          {...props}
        >
          {placeholder && <option value="">{placeholder}</option>}
          {hasGroups
            ? Object.entries(groups).map(([group, opts]) =>
                group === "__default__" ? (
                  opts.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))
                ) : (
                  <optgroup key={group} label={group}>
                    {opts.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </optgroup>
                )
              )
            : options.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))
          }
        </select>
        {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      </div>
    );
  }
);
Select.displayName = "Select";

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ label, error, className, id, ...props }, ref) => {
    const textareaId = id || (label ? label.toLowerCase().replace(/\s+/g, "-") : undefined);

    return (
      <div className="space-y-1.5">
        {label && (
          <label htmlFor={textareaId} className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          id={textareaId}
          className={cn(
            "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400",
            "focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-100",
            "dark:border-zinc-600 dark:bg-zinc-800 dark:text-white dark:focus:border-orange-500 dark:focus:ring-orange-900/30",
            "disabled:cursor-not-allowed disabled:opacity-50 resize-y min-h-[80px]",
            error && "border-red-400 focus:border-red-400 focus:ring-red-100 dark:border-red-500",
            className
          )}
          {...props}
        />
        {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      </div>
    );
  }
);
Textarea.displayName = "Textarea";
