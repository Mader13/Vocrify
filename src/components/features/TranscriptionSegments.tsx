import * as React from "react";
import { useEffect, useRef, useCallback, useState, useMemo } from "react";
import { List } from "react-window";

import { cn } from "@/lib/utils";
import { formatTime } from "@/lib/utils";
import type { CompletedViewLayoutMode } from "@/components/features/completed-view-layout";
import type { TranscriptionSegment } from "@/types";

/**
 * Highlights search query in text
 */
function highlightText(text: string, query: string): React.ReactNode {
  if (!query.trim()) {
    return text;
  }

  const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  const parts = text.split(regex);

  return parts.map((part, index) => {
    if (regex.test(part)) {
      return (
        <mark key={index} className="bg-yellow-300/80 dark:bg-yellow-500/50 text-current rounded px-0.5">
          {part}
        </mark>
      );
    }
    return part;
  });
}

/**
 * Props for the TranscriptionSegments component
 */
export interface TranscriptionSegmentsProps {
  /** Array of transcription segments to display */
  segments: TranscriptionSegment[];
  /** Current playback time in seconds */
  currentTime: number;
  /** Index of segment clicked by user (temporary selection lock) */
  selectedSegmentIndex?: number;
  /** Callback when a segment is clicked, receives the index and start time */
  onSegmentClick: (index: number, startTime: number) => void;
  /** Whether video player is visible (affects height) */
  isVideoVisible?: boolean;
  /** Layout mode for responsive height behavior */
  layoutMode?: CompletedViewLayoutMode;
  /** Search query to highlight in segments */
  searchQuery?: string;
  /** Index of the currently highlighted search result (for navigation) */
  highlightedSearchIndex?: number;
  /** Callback when search index changes */
  onScrollToSegment?: (index: number) => void;
}

/**
 * Props for an individual segment item
 */
interface SegmentItemProps {
  /** The segment data */
  segment: TranscriptionSegment;
  /** Whether this segment is currently active/playing */
  isActive: boolean;
  /** Click handler for the segment */
  onClick: () => void;
  /** Search query to highlight */
  searchQuery?: string;
  /** Whether this segment is the currently highlighted search result */
  isHighlighted?: boolean;
  /** Match index for this segment (e.g., "1/5") */
  matchIndex?: number;
  /** Total matches */
  totalMatches?: number;
}

/**
 * Renders a single transcription segment with speaker badge and text
 */
function SegmentItem({ segment, isActive, onClick, searchQuery, isHighlighted, matchIndex, totalMatches }: SegmentItemProps): React.JSX.Element {
  const hasMatch = searchQuery && (
    segment.text.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (segment.speaker && segment.speaker.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  return (
    <div
      onClick={onClick}
      className={cn(
        "cursor-pointer border-b border-border/70 px-3 py-2.5 transition-colors duration-200 hover:bg-muted/45 sm:px-4 sm:py-3",
        "flex gap-2 sm:gap-4 last:border-b-0",
        isActive && [
          "border-l-2 border-l-primary bg-primary/10",
          "shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--primary)_18%,transparent)]"
        ],
        isHighlighted && !isActive && [
          "border-l-2 border-l-foreground/20 bg-accent/60"
        ]
      )}
    >
      <div className="shrink-0 flex flex-col items-start gap-1">
        <div className={cn(
          "min-w-[50px] font-mono transition-colors duration-200 sm:min-w-[60px]",
          isActive
            ? "text-primary text-[13px] font-semibold sm:text-base"
            : "text-muted-foreground text-[11px] sm:text-sm"
        )}>
          {formatTime(segment.start)}
        </div>
        {hasMatch && matchIndex && totalMatches && (
          <span className="text-[10px] font-semibold text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-900/30 px-1.5 py-0.5 rounded">
            {matchIndex}/{totalMatches}
          </span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        {segment.speaker && (
          <span className={cn(
            "mb-1 inline-block rounded px-1.5 py-0.5 text-xs font-medium transition-colors duration-200 sm:px-2",
            isActive
              ? "bg-primary/20 text-primary"
              : "bg-muted text-foreground/75"
          )}>
            {searchQuery ? highlightText(segment.speaker, searchQuery) : segment.speaker}
          </span>
        )}
        <p className={cn(
          "break-words leading-relaxed transition-colors duration-200",
          isActive
            ? "text-foreground text-[14px] font-medium sm:text-base"
            : "text-[14px] sm:text-sm"
        )}>
          {searchQuery ? highlightText(segment.text, searchQuery) : segment.text}
        </p>
      </div>
    </div>
  );
}

/**
 * Props for virtualized segment row (custom props only)
 */
interface VirtualizedSegmentRowProps {
  /** The segments array */
  segments: TranscriptionSegment[];
  /** Index of the currently active segment */
  activeIndex: number;
  /** Callback when segment is clicked */
  onSegmentClick: (index: number, startTime: number) => void;
  /** Search query to highlight */
  searchQuery?: string;
  /** Array of indices that match the search query */
  matchingIndices?: number[];
  /** Current highlighted search result index */
  highlightedSearchIndex?: number;
}

/**
 * Virtualized segment row renderer for react-window
 * react-window automatically adds: ariaAttributes, index, style
 */
function VirtualizedSegmentRow(
  props: {
    ariaAttributes: {
      "aria-posinset": number;
      "aria-setsize": number;
      role: "listitem";
    };
    index: number;
    style: React.CSSProperties;
  } & VirtualizedSegmentRowProps
): React.JSX.Element {
  const { index, style, segments, activeIndex, onSegmentClick, searchQuery, matchingIndices, highlightedSearchIndex } = props;
  const segment = segments[index];
  const isActive = index === activeIndex;

  // Check if this segment is the currently highlighted search result
  const isHighlighted = highlightedSearchIndex !== undefined && matchingIndices?.[highlightedSearchIndex] === index;
  const matchIndex = matchingIndices?.indexOf(index) !== -1 ? matchingIndices!.indexOf(index) + 1 : undefined;
  const totalMatches = matchingIndices?.length;

  return (
    <div style={style}>
      <SegmentItem
        segment={segment}
        isActive={isActive}
        onClick={() => onSegmentClick(index, segment.start)}
        searchQuery={searchQuery}
        isHighlighted={isHighlighted}
        matchIndex={matchIndex}
        totalMatches={totalMatches}
      />
    </div>
  );
}

/**
 * Component for displaying transcription segments with virtualization support.
 *
 * Features:
 * - React.memo for preventing unnecessary re-renders
 * - Virtualization via react-window for >200 segments
 * - Highlight active segment using React state for proper re-rendering
 * - Auto-scroll to active segment during playback
 * - Click on segment to seek video to start time
 * - Search and highlight matches in segments with navigation
 *
 * @param segments - Array of transcription segments
 * @param currentTime - Current playback time in seconds
 * @param onSegmentClick - Callback when segment is clicked
 * @param searchQuery - Optional search query to highlight
 * @param highlightedSearchIndex - Index of the currently highlighted search result
 * @param onScrollToSegment - Callback to scroll to a specific segment
 */
export const TranscriptionSegments = React.memo<TranscriptionSegmentsProps>(
  ({
    segments,
    currentTime,
    selectedSegmentIndex,
    onSegmentClick,
    isVideoVisible = true,
    layoutMode = "stacked",
    searchQuery = "",
    highlightedSearchIndex,
    onScrollToSegment,
  }): React.JSX.Element => {
    const scrollElementToCenter = useCallback((container: HTMLElement, element: HTMLElement) => {
      const containerRect = container.getBoundingClientRect();
      const elementRect = element.getBoundingClientRect();
      const elementTop = container.scrollTop + (elementRect.top - containerRect.top);
      const centeredTop = elementTop - (container.clientHeight / 2) + (element.clientHeight / 2);

      container.scrollTo({
        top: Math.max(0, centeredTop),
        behavior: "smooth",
      });
    }, []);

    // Calculate matching segment indices based on search query
    const matchingIndices = useMemo(() => {
      if (!searchQuery.trim()) {
        return [];
      }
      const lowerQuery = searchQuery.toLowerCase();
      const matches: number[] = [];
      segments.forEach((segment, index) => {
        if (segment.text.toLowerCase().includes(lowerQuery) ||
          (segment.speaker && segment.speaker.toLowerCase().includes(lowerQuery))) {
          matches.push(index);
        }
      });
      return matches;
    }, [segments, searchQuery]);

    // Scroll to highlighted search result when it changes
    useEffect(() => {
      if (highlightedSearchIndex !== undefined && highlightedSearchIndex >= 0 && matchingIndices[highlightedSearchIndex] !== undefined) {
        const targetIndex = matchingIndices[highlightedSearchIndex];
        if (onScrollToSegment) {
          onScrollToSegment(targetIndex);
        }
      }
    }, [highlightedSearchIndex, matchingIndices, onScrollToSegment]);

    // Refs for segment DOM elements (used for auto-scrolling)
    const segmentRefs = useRef<(HTMLDivElement | null)[]>([]);
    // Ref for the container to check visibility
    const containerRef = useRef<HTMLDivElement>(null);
    // State for the currently active segment index (must be state to trigger re-render)
    const [activeIndex, setActiveIndex] = useState<number>(-1);
    // Ref for tracking the last scrolled-to segment to prevent redundant scrolling
    const lastScrolledIndexRef = useRef<number>(-1);
    // Ref to track if user is manually scrolling (to pause auto-scroll temporarily)
    const isUserScrollingRef = useRef(false);
    const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    /**
     * Update active segment index based on current playback time
     */
    useEffect(() => {
      if (selectedSegmentIndex !== undefined && selectedSegmentIndex >= 0) {
        if (selectedSegmentIndex !== activeIndex) {
          setActiveIndex(selectedSegmentIndex);
        }
        return;
      }

      const lastIndex = segments.length - 1;
      const newActiveIndex = segments.findIndex((segment, index) => {
        if (index === lastIndex) {
          return currentTime >= segment.start && currentTime <= segment.end;
        }

        return currentTime >= segment.start && currentTime < segment.end;
      });

      if (newActiveIndex !== -1 && newActiveIndex !== activeIndex) {
        setActiveIndex(newActiveIndex);
      } else if (newActiveIndex === -1 && activeIndex !== -1) {
        // Clear active index if current time is outside all segments
        setActiveIndex(-1);
      }
    }, [currentTime, segments, activeIndex, selectedSegmentIndex]);

    /**
     * Check if element is visible in container
     */
    const isElementVisible = useCallback((element: HTMLElement, container: HTMLElement) => {
      const elementRect = element.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      
      return (
        elementRect.top >= containerRect.top + 50 && // 50px buffer from top
        elementRect.bottom <= containerRect.bottom - 50 // 50px buffer from bottom
      );
    }, []);

    /**
     * Check if active segment has moved below the middle line of container.
     * While playback is running, we keep active segment at or above middle.
     */
    const isElementBelowMiddle = useCallback((element: HTMLElement, container: HTMLElement) => {
      const elementRect = element.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();

      const elementCenterY = (elementRect.top + elementRect.bottom) / 2;
      const containerMiddleY = (containerRect.top + containerRect.bottom) / 2;

      return elementCenterY > containerMiddleY;
    }, []);

    /**
     * Handle user scroll events to pause auto-scroll
     */
    const handleScroll = useCallback(() => {
      isUserScrollingRef.current = true;
      
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
      
      // Resume auto-scroll after 2 seconds of no user interaction
      scrollTimeoutRef.current = setTimeout(() => {
        isUserScrollingRef.current = false;
      }, 2000);
    }, []);

    /**
     * Auto-scroll to the active segment when it changes
     */
    useEffect(() => {
      if (activeIndex === -1) {
        return;
      }

      // For non-virtualized list (<200 segments), scroll the DOM element
      if (segments.length <= 200) {
        const element = segmentRefs.current[activeIndex];
        const container = containerRef.current;

        if (element && container) {
          const belowMiddle = isElementBelowMiddle(element, container);
          const notVisible = !isElementVisible(element, container);
          const shouldScroll = belowMiddle || notVisible;
          const indexChanged = activeIndex !== lastScrolledIndexRef.current;
          const canAutoScroll = !isUserScrollingRef.current || belowMiddle;

          if (shouldScroll && canAutoScroll && (indexChanged || belowMiddle)) {
            scrollElementToCenter(container, element);
          }
        }
      }

      // For virtualized list, the List component handles scrolling internally
      lastScrolledIndexRef.current = activeIndex;
    }, [
      activeIndex,
      currentTime,
      segments.length,
      isElementVisible,
      isElementBelowMiddle,
      scrollElementToCenter,
    ]);

    const shouldCapHeight = isVideoVisible && layoutMode === "stacked";

    /**
     * Render all segments without virtualization (<200 segments)
     */
    if (segments.length <= 200) {
      return (
        <div
          ref={containerRef}
          onScroll={handleScroll}
          onWheel={(e) => e.stopPropagation()}
          className={cn(
            "flex flex-col overflow-y-auto",
            shouldCapHeight ? "max-h-[44vh] sm:max-h-[400px]" : "h-full"
          )}
        >
          {segments.map((segment, index) => {
            const isHighlighted = highlightedSearchIndex !== undefined && matchingIndices[highlightedSearchIndex] === index;
            const matchIndex = matchingIndices.indexOf(index) !== -1 ? matchingIndices.indexOf(index) + 1 : undefined;

            return (
              <div
                key={`${segment.start}-${index}`}
                data-segment-index={index}
                ref={(el) => {
                  segmentRefs.current[index] = el;
                }}
              >
                <SegmentItem
                  segment={segment}
                  isActive={index === activeIndex}
                  onClick={() => onSegmentClick(index, segment.start)}
                  searchQuery={searchQuery}
                  isHighlighted={isHighlighted}
                  matchIndex={matchIndex}
                  totalMatches={matchingIndices.length || undefined}
                />
              </div>
            );
          })}
        </div>
      );
    }

    /**
     * Render segments with virtualization (>200 segments)
     */
    const rowProps = {
      segments,
      activeIndex: activeIndex,
      onSegmentClick,
      searchQuery,
      matchingIndices,
      highlightedSearchIndex,
    };

    return (
      <div
        className={cn(shouldCapHeight ? "max-h-[44vh] sm:max-h-[400px]" : "h-full")}
        onWheel={(e) => e.stopPropagation()}
      >
        <List
          rowCount={segments.length}
          rowHeight={80}
          rowComponent={VirtualizedSegmentRow}
          rowProps={rowProps}
          overscanCount={5}
          style={{ height: shouldCapHeight ? "44vh" : "100%" }}
        />
      </div>
    );
  }
);

TranscriptionSegments.displayName = "TranscriptionSegments";
