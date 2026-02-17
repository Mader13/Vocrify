import { useState, useMemo } from "react";
import { Archive, Trash2, Search, Calendar, ArrowUpDown, X, ChevronLeft, ChevronRight, Sparkles, FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatFileSize, formatDateTime } from "@/lib/utils";
import { useArchivedTasks, useTasks, useUIStore } from "@/stores";
import type { TranscriptionTask } from "@/types";
import { ExportMenu } from "@/components/features/ExportMenu";
import { ArchiveCleanupModal } from "./ArchiveCleanupModal";
import { openArchiveFolder } from "@/services/tauri";

type SortOption = "date-desc" | "date-asc" | "name-asc" | "name-desc";

const ITEMS_PER_PAGE_OPTIONS = [10, 25, 50, 100];

export function ArchiveView() {
  const archivedTasks = useArchivedTasks();
  const removeTask = useTasks((s) => s.removeTask);
  const setSelectedTask = useUIStore((s) => s.setSelectedTask);
  const setCurrentView = useUIStore((s) => s.setCurrentView);
  
  const [searchQuery, setSearchQuery] = useState("");
  const [sortOption, setSortOption] = useState<SortOption>("date-desc");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);
  const [isCleanupModalOpen, setIsCleanupModalOpen] = useState(false);

  const getArchivedSize = (task: TranscriptionTask): number => task.archiveSize ?? task.fileSize;

  const filteredAndSortedTasks = useMemo(() => {
    let result = [...archivedTasks];

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter((task) =>
        task.fileName.toLowerCase().includes(query)
      );
    }

    if (dateFrom) {
      const fromDate = new Date(dateFrom);
      fromDate.setHours(0, 0, 0, 0);
      result = result.filter((task) => new Date(task.createdAt) >= fromDate);
    }
    if (dateTo) {
      const toDate = new Date(dateTo);
      toDate.setHours(23, 59, 59, 999);
      result = result.filter((task) => new Date(task.createdAt) <= toDate);
    }

    result.sort((a, b) => {
      const [field, order] = sortOption.split("-") as ["date" | "name", "asc" | "desc"];
      let comparison = 0;
      if (field === "name") {
        comparison = a.fileName.localeCompare(b.fileName);
      } else {
        const dateA = new Date(a.createdAt).getTime();
        const dateB = new Date(b.createdAt).getTime();
        comparison = dateA - dateB;
      }
      return order === "asc" ? comparison : -comparison;
    });

    return result;
  }, [archivedTasks, searchQuery, sortOption, dateFrom, dateTo]);

  const totalArchivedSize = useMemo(
    () => archivedTasks.reduce((sum, task) => sum + getArchivedSize(task), 0),
    [archivedTasks]
  );

  // Pagination
  const totalPages = Math.ceil(filteredAndSortedTasks.length / itemsPerPage);
  const paginatedTasks = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredAndSortedTasks.slice(start, start + itemsPerPage);
  }, [filteredAndSortedTasks, currentPage, itemsPerPage]);

  // Reset page when filters change
  const handleFilterChange = (setter: (value: string) => void) => (value: string) => {
    setter(value);
    setCurrentPage(1);
  };

  const handleTaskClick = (taskId: string) => {
    setSelectedTask(taskId);
    setCurrentView("transcription");
  };

  const handleOpenArchiveFolder = async () => {
    const result = await openArchiveFolder();
    if (!result.success) {
      console.error("Failed to open archive folder:", result.error);
    }
  };

  if (archivedTasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-8">
        <div className="rounded-full bg-muted p-4 mb-4">
          <Archive className="h-8 w-8 text-muted-foreground" />
        </div>
        <h2 className="text-lg font-semibold mb-2">Archive is Empty</h2>
        <p className="text-sm text-muted-foreground max-w-sm">
          Archived transcriptions will appear here. Click the archive icon
          next to a transcription result to move it to the archive.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 overflow-y-auto h-full">
      {/* Header and count */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-muted-foreground">
            {filteredAndSortedTasks.length.toLocaleString()} videos in archive
          </p>
          <p className="text-sm text-muted-foreground">
            Storage used: <span className="font-medium text-foreground">{formatFileSize(totalArchivedSize)}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleOpenArchiveFolder}
            className="gap-1.5"
          >
            <FolderOpen className="h-4 w-4" />
            Open Archive Folder
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsCleanupModalOpen(true)}
            className="gap-1.5"
          >
            <Sparkles className="h-4 w-4" />
            Cleanup
          </Button>
        </div>
      </div>

      {/* Filters and sorting panel */}
      <div className="flex flex-col gap-3 p-3 bg-muted/50 rounded-lg">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search by name..."
            value={searchQuery}
            onChange={(e) => handleFilterChange(setSearchQuery)(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-background border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
          {searchQuery && (
            <button
              onClick={() => handleFilterChange(setSearchQuery)("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Date filters and sorting */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Date from filter */}
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-muted-foreground shrink-0" />
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => handleFilterChange(setDateFrom)(e.target.value)}
              className="w-[130px] px-2 py-1.5 bg-background border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              title="From date"
            />
          </div>

          {/* Date to filter */}
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-sm">—</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => handleFilterChange(setDateTo)(e.target.value)}
              className="w-[130px] px-2 py-1.5 bg-background border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              title="To date"
            />
          </div>

          {/* Sorting */}
          <div className="flex items-center gap-2">
            <ArrowUpDown className="h-4 w-4 text-muted-foreground shrink-0" />
            <select
              value={sortOption}
              onChange={(e) => {
                setSortOption(e.target.value as SortOption);
                setCurrentPage(1);
              }}
              className="h-8 px-2 py-1 bg-background border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 w-auto min-w-[180px]"
            >
              <option value="date-desc">Newest First</option>
              <option value="date-asc">Oldest First</option>
              <option value="name-asc">Name A→Z</option>
              <option value="name-desc">Name Z→A</option>
            </select>
          </div>
        </div>
      </div>

      {/* Archived tasks table */}
      <div className="border rounded-lg overflow-hidden bg-background">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 border-b">
            <tr>
              <th className="text-left py-3 px-4 font-medium text-muted-foreground">File</th>
              <th className="text-left py-3 px-4 font-medium text-muted-foreground w-24">Size</th>
              <th className="text-left py-3 px-4 font-medium text-muted-foreground w-36">Date</th>
              <th className="text-right py-3 px-4 font-medium text-muted-foreground w-24">Actions</th>
            </tr>
          </thead>
          <tbody>
            {paginatedTasks.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-8 text-center text-muted-foreground">
                  No results found for the specified filters
                </td>
              </tr>
            ) : (
              paginatedTasks.map((task) => (
                <tr
                  key={task.id}
                  className="border-b last:border-b-0 hover:bg-muted/30 cursor-pointer transition-colors"
                  onClick={() => handleTaskClick(task.id)}
                >
                  <td className="py-3 px-4">
                    <span className="font-medium truncate max-w-[250px] sm:max-w-[350px] lg:max-w-[450px]" title={task.fileName}>
                      {task.fileName}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-muted-foreground whitespace-nowrap">
                    {formatFileSize(getArchivedSize(task))}
                  </td>
                  <td className="py-3 px-4 text-muted-foreground whitespace-nowrap">
                    {formatDateTime(task.createdAt)}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <div className="flex items-center justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
                      <ExportMenu task={task} iconOnly />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeTask(task.id);
                        }}
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {filteredAndSortedTasks.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
          {/* Items per page */}
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>Show:</span>
            <select
              value={itemsPerPage}
              onChange={(e) => {
                setItemsPerPage(Number(e.target.value));
                setCurrentPage(1);
              }}
              className="h-8 px-2 py-1 bg-background border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            >
              {ITEMS_PER_PAGE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <span>per page</span>
          </div>

          {/* Page navigation */}
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 px-2"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>

            <span className="text-sm text-muted-foreground px-2">
              {currentPage} of {totalPages || 1}
            </span>

            <Button
              variant="outline"
              size="sm"
              className="h-8 px-2"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage >= totalPages}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          {/* Records info */}
          <div className="text-sm text-muted-foreground">
            {filteredAndSortedTasks.length > 0 && (
              <>
                {(currentPage - 1) * itemsPerPage + 1}–
                {Math.min(currentPage * itemsPerPage, filteredAndSortedTasks.length)} of{" "}
                {filteredAndSortedTasks.length}
              </>
            )}
          </div>
        </div>
      )}

      <ArchiveCleanupModal
        tasks={archivedTasks}
        isOpen={isCleanupModalOpen}
        onClose={() => setIsCleanupModalOpen(false)}
      />
    </div>
  );
}
