# 🎬 Видеоплеер с аудиограммой и синхронизированной транскрипцией

## 📋 Обзор

Реализация видеоплеера с аудиограммой и синхронизированной транскрипцией для Tauri приложения транскрибации.

**Ключевые решения:**
- Браузерная генерация waveform peaks (через Wavesurfer.js)
- Виртуализация списков сегментов (react-window) с порогом 200 сегментов
- Кэширование peaks в localStorage для быстрой перезагрузки
- Производительная синхронизация через refs (без React state для timeupdate)
- Цветовая схема на основе CSS переменных темы (shadcn)
- Экспорт в 5 форматов: TXT, SRT, VTT, JSON, MD

---

## 🏗️ Архитектура компонентов

### Новые файлы:

#### 1. **src/components/features/VideoPlayer.tsx** (~280 строк)
- HTML5 `<video>` элемент
- Wavesurfer.js (высота 120px)
- Regions Plugin для отображения сегментов
- Кэширование peaks в localStorage
- Переключение режимов раскраски (segments/speakers)
- Синхронизация видео ↔ waveform
- Spinner пока waveform генерируется

#### 2. **src/components/features/CustomVideoControls.tsx** (~140 строк)
- Play/Pause кнопка
- Прогресс-бар (HTML5 range input)
- Текущее время / общая длительность
- Громкость (range input)
- Горячие клавиши (Space, стрелки, громкость)

#### 3. **src/components/features/TranscriptionSegments.tsx** (~220 строк)
- React.memo для предотвращения ре-рендеров
- Виртуализация через react-window (если >200 сегментов)
- Подсветка активного сегмента через refs (БЕЗ React state!)
- Auto-scroll к активному сегменту
- Клик на сегмент → перемотка видео

#### 4. **src/components/features/ExportMenu.tsx** (~150 строк)
- Dropdown меню с кнопкой "Экспорт"
- Форматы: TXT, SRT, VTT, JSON, MD

### Обновляемые файлы:

#### 5. **src/components/features/TranscriptionView.tsx** (обновление)
- Новая структура: видеоплеер сверху (40%), транскрипция снизу (60%)
- Интеграция всех новых компонентов
- Обработка состояний (processing, completed)

#### 6. **src/lib/utils.ts** (дополнение)
- formatSRTTime, formatVTTTime
- getThemeColors (из CSS переменных)
- cacheWaveformPeaks, getCachedWaveformPeaks
- downloadFile

#### 7. **src/types/index.ts** (дополнение)
- WaveformColorMode, ExportFormat
- VideoPlayerState, WaveformRegion

#### 8. **src/index.css** (дополнение)
- Стили сегментов транскрипции
- Speaker badge
- Waveform container
- Кастомные range inputs
- Анимации

#### 9. **src/components/features/index.ts** (обновление экспортов)

---

## 📦 Зависимости

```bash
bun add wavesurfer.js react-window lodash-es
bun add -d @types/react-window
```

---

## 🚀 План выполнения (9 этапов)

### Этап 1: Инфраструктура (30 мин)
1. Установить зависимости
2. Добавить типы в `types/index.ts`
3. Добавить утилиты в `lib/utils.ts`

### Этап 2: Базовый плеер (2 часа)
4. Создать `VideoPlayer.tsx` - базовая структура
5. Интегрировать Wavesurfer.js
6. Добавить кэширование peaks
7. Создать `CustomVideoControls.tsx`

### Этап 3: Регионы и раскраска (1.5 часа)
8. Добавить Regions Plugin
9. Реализовать создание регионов по сегментам
10. Реализовать раскраску по спикерам
11. Добавить переключатель режимов

### Этап 4: Транскрипция (2 часа)
12. Создать `TranscriptionSegments.tsx`
13. Реализовать виртуализацию (react-window)
14. Реализовать подсветку через refs

### Этап 5: Синхронизация (2 часа)
15. Синхронизация видео ↔ waveform
16. Синхронизация видео ↔ транскрипция
17. Добавить debounce

### Этап 6: UX (1.5 часа)
18. Добавить горячие клавиши
19. Добавить spinner для waveform
20. Добавить auto-scroll

### Этап 7: Экспорт (2 часа)
21. Создать `ExportMenu.tsx`
22. Реализовать все форматы экспорта

### Этап 8: Интеграция (45 мин)
23. Обновить `TranscriptionView.tsx`
24. Обновить экспорты
25. Добавить стили

### Этап 9: Тестирование (1.5 часа)
26. Проверить на разных форматах видео
27. Проверить производительность
28. Проверить горячие клавиши
29. Проверить экспорт

**Итого время: ~12 часов**

---

## 📁 Структура файлов (итоговая)

```
src/
├── components/
│   ├── features/
│   │   ├── VideoPlayer.tsx               [НОВЫЙ - ~280 строк]
│   │   ├── CustomVideoControls.tsx       [НОВЫЙ - ~140 строк]
│   │   ├── TranscriptionSegments.tsx     [НОВЫЙ - ~220 строк]
│   │   ├── ExportMenu.tsx                [НОВЫЙ - ~150 строк]
│   │   ├── TranscriptionView.tsx         [ОБНОВИТЬ - +80 строк]
│   │   └── index.ts                      [ОБНОВИТЬ - экспорты]
│   └── ui/
│       └── dropdown-menu.tsx             [НОВЫЙ - для ExportMenu]
├── lib/
│   └── utils.ts                          [ОБНОВИТЬ - +90 строк]
├── types/
│   └── index.ts                          [ОБНОВИТЬ - +20 строк]
└── index.css                             [ОБНОВИТЬ - +60 строк]
```

**Общий объем кода:**
- Новых файлов: 5 (~790 строк)
- Обновленных файлов: 4 (~250 строк)
- **Итого:** ~1040 строк нового кода

---

## 🎯 Критерии успеха

✅ Видео воспроизводится синхронно с waveform (60fps)  
✅ Waveform генерируется и кэшируется в localStorage  
✅ Клик на сегмент перематывает видео  
✅ Текущий сегмент подсвечивается автоматически  
✅ Переключение режимов раскраски работает  
✅ Горячие клавиши работают корректно  
✅ Экспорт генерирует валидные файлы (TXT, SRT, VTT, JSON, MD)  
✅ Виртуализация работает для длинных транскрипций (>200 сегментов)  
✅ Кэширование ускоряет повторную загрузку waveform  
✅ Производительность: 60fps при воспроизведении длинных видео  

---

## ⚠️ Потенциальные проблемы и решения

### 1. Длинные видео (>1 час)
**Проблема:** Waveform генерируется долго в браузере  
**Решение:**
- Показывать spinner с прогрессом
- Кэшировать peaks в localStorage (24 часа)
- Использовать `backend: 'WebAudio'` для быстрой генерации

### 2. Производительность на 1000+ сегментов
**Проблема:** Много DOM элементов  
**Решение:**
- Виртуализация через react-window (уже запланировано)
- Рендерить только ~50 видимых сегментов

### 3. Синхронизация drift
**Проблема:** Видео и wavesurfer могут рассинхронизироваться  
**Решение:**
- Debounce на 100ms для timeupdate
- Использовать `wavesurfer.setTime()` в каждом обновлении

### 4. Цвета в теме
**Проблема:** CSS переменные могут быть недоступны  
**Решение:**
- Fallback цвета (если getComputedStyle возвращает пустую строку)
- Динамическое обновление при смене темы

---

## 🔧 Технические детали реализации

### 1. Интеграция Wavesurfer.js

```typescript
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions';

// В VideoPlayer компоненте
useEffect(() => {
  if (!waveformRef.current || !task.filePath) return;
  
  // Проверка кэша
  const cachedPeaks = getCachedWaveformPeaks(task.filePath);
  setWaveformLoading(!cachedPeaks);
  
  // Создание wavesurfer
  const ws = WaveSurfer.create({
    container: waveformRef.current,
    waveColor: getThemeColors().waveColor,
    progressColor: getThemeColors().progressColor,
    height: 120,
    barWidth: 2,
    barGap: 1,
    barRadius: 2,
    backend: 'WebAudio',
    interact: true,
    normalize: true,
  });
  
  // Регистрация плагина regions
  const regions = RegionsPlugin.create();
  ws.registerPlugin(regions);
  regionsPluginRef.current = regions;
  
  // Загрузка аудио
  if (cachedPeaks) {
    ws.load(task.filePath, cachedPeaks);
  } else {
    ws.load(task.filePath);
  }
  
  // События
  ws.on('ready', () => {
    setWaveformLoading(false);
    // Кэширование peaks для будущих загрузок
    const peaks = ws.getDecodedData().channelData[0];
    cacheWaveformPeaks(task.filePath, peaks);
    createRegions(colorMode);
  });
  
  ws.on('interaction', (time) => {
    if (videoRef.current) {
      videoRef.current.currentTime = time;
    }
  });
  
  wavesurferRef.current = ws;
  
  return () => {
    ws.destroy();
  };
}, [task.filePath, colorMode]);
```

### 2. Создание регионов с theme colors

```typescript
const createRegions = useCallback((mode: 'segments' | 'speakers') => {
  const regions = regionsPluginRef.current;
  if (!regions || !task.result) return;
  
  regions.clearRegions();
  const themeColors = getThemeColors();
  
  if (mode === 'segments') {
    // Радужная палитра на основе chart цветов
    task.result.segments.forEach((segment, index) => {
      const colorIndex = Math.floor((index / task.result.segments.length) * themeColors.chartColors.length);
      regions.addRegion({
        start: segment.start,
        end: segment.end,
        color: themeColors.chartColors[colorIndex],
        drag: false,
        resize: false,
      });
    });
  } else {
    // Группировка по спикерам
    const speakers = Array.from(
      new Set(task.result.segments.map(s => s.speaker || 'Unknown'))
    );
    
    const speakerColors = speakers.reduce((acc, speaker, i) => {
      acc[speaker] = themeColors.chartColors[i % themeColors.chartColors.length];
      return acc;
    }, {} as Record<string, string>);
    
    task.result.segments.forEach(segment => {
      regions.addRegion({
        start: segment.start,
        end: segment.end,
        color: speakerColors[segment.speaker || 'Unknown'],
        drag: false,
        resize: false,
      });
    });
  }
}, [task.result, colorMode]);
```

### 3. Синхронизация с debounce

```typescript
import { debounce } from 'lodash-es'; // или реализовать свою

useEffect(() => {
  const video = videoRef.current;
  if (!video) return;
  
  // Debounced версия для производительности
  const debouncedUpdate = debounce((time: number) => {
    currentTimeRef.current = time;
    
    // Синхронизация waveform
    wavesurferRef.current?.setTime(time);
    
    // Обновление транскрипции (через callback)
    onTimeUpdate?.(time);
  }, 100); // 100ms debounce
  
  const handleTimeUpdate = () => {
    debouncedUpdate(video.currentTime);
  };
  
  video.addEventListener('timeupdate', handleTimeUpdate);
  
  return () => {
    video.removeEventListener('timeupdate', handleTimeUpdate);
    debouncedUpdate.cancel();
  };
}, [onTimeUpdate]);
```

### 4. Виртуализация через react-window

```typescript
import { FixedSizeList } from 'react-window';

// В TranscriptionSegments компоненте
const segments = props.segments;

// Порог виртуализации: >200 сегментов
const useVirtualization = segments.length > 200;

if (useVirtualization) {
  return (
    <FixedSizeList
      height={containerHeight}
      itemCount={segments.length}
      itemSize={100} // Высота каждого сегмента
      width="100%"
    >
      {({ index, style }) => (
        <Segment
          ref={el => segmentRefs.current[index] = el}
          segment={segments[index]}
          style={style}
          isActive={index === activeSegmentRef.current}
          onClick={() => props.onSegmentClick(segments[index].start)}
        />
      )}
    </FixedSizeList>
  );
}

// Без виртуализации (менее 200 сегментов)
return (
  <div className="space-y-2">
    {segments.map((segment, index) => (
      <Segment
        key={index}
        ref={el => segmentRefs.current[index] = el}
        segment={segment}
        isActive={index === activeSegmentRef.current}
        onClick={() => props.onSegmentClick(segment.start)}
      />
    ))}
  </div>
);
```

### 5. Горячие клавиши

```typescript
useEffect(() => {
  const handleKeyPress = (e: KeyboardEvent) => {
    // Игнорировать если фокус в input
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    
    const video = videoRef.current;
    if (!video) return;
    
    switch (e.code) {
      case 'Space':
        e.preventDefault();
        video.paused ? video.play() : video.pause();
        break;
      
      case 'ArrowLeft':
        e.preventDefault();
        video.currentTime = Math.max(0, video.currentTime - 5);
        break;
      
      case 'ArrowRight':
        e.preventDefault();
        video.currentTime = Math.min(video.duration, video.currentTime + 5);
        break;
      
      case 'ArrowUp':
        e.preventDefault();
        video.volume = Math.min(1, video.volume + 0.1);
        break;
      
      case 'ArrowDown':
        e.preventDefault();
        video.volume = Math.max(0, video.volume - 0.1);
        break;
    }
  };
  
  window.addEventListener('keydown', handleKeyPress);
  return () => window.removeEventListener('keydown', handleKeyPress);
}, []);
```

### 6. Экспорт во все форматы

```typescript
// TXT экспорт
const exportToTXT = () => {
  const content = segments.map(s => 
    `[${formatTime(s.start)}] ${s.speaker ? s.speaker + ': ' : ''}${s.text}`
  ).join('\n\n');
  
  downloadFile(content, `${task.fileName}.txt`, 'text/plain');
};

// SRT экспорт
const exportToSRT = () => {
  const content = segments.map((s, i) => 
    `${i + 1}\n${formatSRTTime(s.start)} --> ${formatSRTTime(s.end)}\n${s.text}\n`
  ).join('\n');
  
  downloadFile(content, `${task.fileName}.srt`, 'text/plain');
};

// VTT экспорт
const exportToVTT = () => {
  const header = 'WEBVTT\n\n';
  const content = segments.map((s, i) => 
    `${i + 1}\n${formatVTTTime(s.start)} --> ${formatVTTTime(s.end)}\n${s.text}\n`
  ).join('\n');
  
  downloadFile(header + content, `${task.fileName}.vtt`, 'text/vtt');
};

// JSON экспорт
const exportToJSON = () => {
  const data = {
    fileName: task.fileName,
    duration: task.result?.duration,
    language: task.result?.language,
    segments: segments,
    exportedAt: new Date().toISOString(),
  };
  
  downloadFile(JSON.stringify(data, null, 2), `${task.fileName}.json`, 'application/json');
};

// MD экспорт
const exportToMD = () => {
  const content = `# ${task.fileName}\n\n` +
    segments.map(s => 
      `**[${formatTime(s.start)}]** ${s.speaker ? `**${s.speaker}:** ` : ''}${s.text}\n\n`
    ).join('');
  
  downloadFile(content, `${task.fileName}.md`, 'text/markdown');
};
```

---

## 📝 Резюме

**План готов к реализации!**

Все ключевые аспекты учтены:
- Производительная синхронизация через refs
- Браузерная генерация waveform с кэшированием
- Виртуализация для длинных транскрипций
- Theme colors из CSS переменных
- Полный экспорт в 5 форматов
- Горячие клавиши и UX улучшения

Ожидаемое время реализации: **~12 часов**

**Готов приступить к реализации!** 🚀