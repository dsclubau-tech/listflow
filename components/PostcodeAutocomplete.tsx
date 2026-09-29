"use client";

import { useEffect, useRef, useState } from "react";
import {
  getEbayCountryMetadata,
  getZipcodeLocationText,
  getSuburbsForAuPostcode,
  searchAuPostcodes,
  type AuPostcodeSuggestion,
} from "@/lib/ebay-location";

interface PostcodeAutocompleteProps {
  value: string;
  onChange: (postcode: string, locationText: string) => void;
  country?: string;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  maxLength?: number;
  showHint?: boolean;
  selectedLocationText?: string;
  mode?: "suburb" | "postcode";
}

export function PostcodeAutocomplete({
  value,
  onChange,
  country = "Australia",
  placeholder = "e.g. 2217",
  className = "w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 text-gray-900 bg-white",
  disabled = false,
  maxLength = 6,
  showHint = true,
  selectedLocationText,
  mode = "suburb",
}: PostcodeAutocompleteProps) {
  const [suggestions, setSuggestions] = useState<AuPostcodeSuggestion[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [internalSelectedLocation, setInternalSelectedLocation] = useState<string>("");
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  const countryMetadata = getEbayCountryMetadata(country);
  const isAu = countryMetadata.code === "AU";

  const effectiveSelectedLocation =
    selectedLocationText !== undefined ? selectedLocationText : internalSelectedLocation;

  const resolvedLocation = isAu
    ? getZipcodeLocationText(value, country, effectiveSelectedLocation)
    : "";

  useEffect(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
  }, [country]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const rawVal = e.target.value;
    setInternalSelectedLocation("");
    const newLoc = isAu && mode === "suburb" ? getZipcodeLocationText(rawVal, country) : "";
    onChange(rawVal, newLoc);

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    if (mode === "suburb" && isAu && rawVal.trim().length >= 1) {
      debounceTimerRef.current = setTimeout(() => {
        const matches = searchAuPostcodes(rawVal.trim(), 25);
        setSuggestions(matches);
        setIsOpen(matches.length > 0);
        setActiveIndex(-1);
      }, 100);
    } else {
      setSuggestions([]);
      setIsOpen(false);
    }
  }

  function handleSelectSuggestion(suggestion: AuPostcodeSuggestion) {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    setInternalSelectedLocation(suggestion.locationText);
    onChange(suggestion.postcode, suggestion.locationText);
    setIsOpen(false);
    setSuggestions([]);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!isOpen || suggestions.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((prev) => (prev < suggestions.length - 1 ? prev + 1 : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((prev) => (prev > 0 ? prev - 1 : suggestions.length - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const targetIndex = activeIndex >= 0 ? activeIndex : 0;
      if (targetIndex < suggestions.length) {
        handleSelectSuggestion(suggestions[targetIndex]);
      }
    } else if (e.key === "Escape") {
      setIsOpen(false);
    }
  }

  return (
    <div ref={containerRef} className="relative w-full">
      <input
        type="text"
        value={value}
        onChange={handleInputChange}
        onFocus={() => {
          if (mode === "suburb" && isAu && value.trim().length >= 1) {
            const matches = searchAuPostcodes(value.trim(), 25);
            setSuggestions(matches);
            setIsOpen(matches.length > 0);
          }
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        maxLength={maxLength}
        inputMode={mode === "postcode" ? "numeric" : undefined}
        className={className}
      />

      {showHint && isAu && value.trim() && mode === "suburb" && (
        <span className={`mt-1 block text-xs font-medium truncate ${resolvedLocation ? "text-emerald-600" : "text-amber-700"}`} title={resolvedLocation || "Select suburb"}>
          {resolvedLocation ? `📍 ${resolvedLocation}` : getSuburbsForAuPostcode(value) ? "Select suburb" : "Enter a valid postcode"}
        </span>
      )}

      {mode === "suburb" && isAu && isOpen && suggestions.length > 0 && (
        <ul
          onMouseDown={(e) => e.preventDefault()}
          className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-md bg-white py-1 shadow-lg ring-1 ring-black/5 text-xs"
        >
          {suggestions.map((item, index) => {
            const isSelected = index === activeIndex;
            const isCurrentSelected =
              resolvedLocation === item.locationText;
            return (
              <li
                key={`${item.postcode}-${item.suburb}-${index}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleSelectSuggestion(item);
                }}
                onClick={() => handleSelectSuggestion(item)}
                onMouseEnter={() => setActiveIndex(index)}
                className={`cursor-pointer px-3 py-2 transition-colors flex items-center justify-between ${
                  isSelected
                    ? "bg-orange-50 text-orange-900 font-medium"
                    : isCurrentSelected
                      ? "bg-emerald-50 text-emerald-900 font-medium"
                      : "text-gray-700 hover:bg-gray-50"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-gray-900 w-12">{item.postcode}</span>
                  <span className="text-gray-800 font-medium">{item.suburb}</span>
                  {isCurrentSelected && (
                    <span className="text-emerald-600 font-bold ml-1 text-xs">✓</span>
                  )}
                </div>
                <span className="text-gray-400 text-[10px] uppercase font-mono">{item.state}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

