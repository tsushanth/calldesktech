'use client';

import { useState, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

interface PlaceResult {
  place_id: string;
  name: string;
  address: string;
  types: string[];
}

export interface PlaceDetails {
  place_id: string;
  name: string;
  address: string;
  phone?: string;
  website?: string;
  business_hours?: Record<string, { open: string; close: string; closed: boolean }>;
  business_type?: string;
  services?: string[];
  place_types?: string[];
}

interface BusinessLookupProps {
  onSelect: (details: PlaceDetails) => void;
  placeholder?: string;
  className?: string;
}

export function BusinessLookup({ onSelect, placeholder = 'Search for your business...', className }: BusinessLookupProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  // Debounced search
  useEffect(() => {
    if (query.length < 3) {
      setResults([]);
      setIsOpen(false);
      return;
    }

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(async () => {
      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch(`/api/places/search?query=${encodeURIComponent(query)}`);
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Search failed');
        }

        setResults(data.results || []);
        setIsOpen(data.results?.length > 0);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Search failed');
        setResults([]);
      } finally {
        setIsLoading(false);
      }
    }, 300);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [query]);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = async (place: PlaceResult) => {
    setIsLoading(true);
    setIsOpen(false);
    setQuery(place.name);

    try {
      const response = await fetch(`/api/places/details?place_id=${encodeURIComponent(place.place_id)}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to get details');
      }

      // Include place_types from the search result
      const detailsWithTypes: PlaceDetails = {
        ...data,
        place_types: place.types || [],
      };

      onSelect(detailsWithTypes);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get business details');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setIsOpen(true)}
          placeholder={placeholder}
          className="w-full px-4 py-3 pl-10 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent text-gray-900 bg-white placeholder-gray-400"
        />
        <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
          {isLoading ? (
            <svg className="w-5 h-5 text-gray-400 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
          ) : (
            <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          )}
        </div>
      </div>

      {/* Results dropdown */}
      {isOpen && results.length > 0 && (
        <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-auto">
          {results.map((place) => (
            <button
              key={place.place_id}
              onClick={() => handleSelect(place)}
              className="w-full px-4 py-3 text-left hover:bg-gray-50 border-b border-gray-100 last:border-b-0"
            >
              <div className="font-medium text-gray-900">{place.name}</div>
              <div className="text-sm text-gray-500 truncate">{place.address}</div>
            </button>
          ))}
        </div>
      )}

      {/* Error message */}
      {error && (
        <p className="mt-1 text-sm text-red-600">{error}</p>
      )}

      {/* Helper text */}
      <p className="mt-1 text-xs text-gray-500">
        Search for your business on Google to auto-fill details
      </p>
    </div>
  );
}
