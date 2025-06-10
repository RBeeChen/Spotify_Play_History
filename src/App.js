import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';

// 輔助函數
const formatMsToMinSec = (ms) => {
    if (typeof ms !== 'number' || ms < 0) {
        return "N/A";
    }
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};

const getMsFromRecord = (record_ms_played) => {
    let ms = 0;
    if (typeof record_ms_played === 'number') {
        ms = Math.floor(record_ms_played);
    } else if (typeof record_ms_played === 'string' && /^\d+$/.test(record_ms_played)) {
        ms = parseInt(record_ms_played, 10);
    }
    return ms;
};

const parseDateFromString = (date_str) => {
    if (!date_str) {
        return null;
    }
    // Expected format YYYYMMDD
    if (!/^\d{8}$/.test(date_str)) {
        console.warn(`日期格式錯誤: '${date_str}'。應為YYYYMMDD。`);
        return null;
    }
    const year = parseInt(date_str.substring(0, 4), 10);
    const month = parseInt(date_str.substring(4, 6), 10) - 1; // Month is 0-indexed in Date
    const day = parseInt(date_str.substring(6, 8), 10);

    const dateObj = new Date(year, month, day);
    // Validate if the date components actually form the date they represent
    if (dateObj.getFullYear() !== year || dateObj.getMonth() !== month || dateObj.getDate() !== day) {
        console.warn(`日期值無效: '${date_str}'。`);
        return null;
    }
    return dateObj;
};


const filterDataByDate = (data_list, start_date_obj, end_date_obj) => {
    if (!start_date_obj || !end_date_obj) {
        return data_list;
    }

    const filtered_list = [];
    for (const item of data_list) {
        if (typeof item !== 'object' || item === null || !('ts' in item)) {
            continue;
        }
        try {
            const item_date_str = item.ts.substring(0, 10); // Extract YYYY-MM-DD
            const item_date = new Date(item_date_str); // Create Date object

            // Normalize dates to start of day for comparison
            const start_date_normalized = new Date(start_date_obj.getFullYear(), start_date_obj.getMonth(), start_date_obj.getDate());
            const end_date_normalized = new Date(end_date_obj.getFullYear(), end_date_obj.getMonth(), end_date_obj.getDate());
            const item_date_normalized = new Date(item_date.getFullYear(), item_date.getMonth(), item_date.getDate());

            if (item_date_normalized >= start_date_normalized && item_date_normalized <= end_date_normalized) {
                filtered_list.push(item);
            }
        } catch (e) {
            console.warn(`跳過無效日期格式的記錄: ${item.ts}`, e);
        }
    }
    return filtered_list;
};

const rankData = (data_list, field_to_rank_key, num_results_to_show_str, rank_metric = "count") => {
    if (!data_list || !field_to_rank_key) {
        return [];
    }

    const item_metrics = new Map(); // Use Map to preserve insertion order for keys, or for more complex keys

    for (const item_record of data_list) {
        if (typeof item_record !== 'object' || item_record === null) {
            continue;
        }

        let key_value = null;
        if (field_to_rank_key === "master_metadata_track_name") {
            const track = item_record.master_metadata_track_name || "未知歌曲";
            const artist = item_record.master_metadata_album_artist_name || "未知歌手";
            key_value = `${track} - ${artist}`; // Combine for uniqueness
        } else if (field_to_rank_key === "master_metadata_album_album_name") {
            const album = item_record.master_metadata_album_album_name || "未知專輯";
            const artist = item_record.master_metadata_album_artist_name || "未知歌手";
            key_value = `${album} - ${artist}`;
        } else if (field_to_rank_key === "ms_played") {
            // When ranking by total play duration, we rank by song/album/URI accumulated duration
            const track = item_record.master_metadata_track_name || "未知歌曲";
            const artist = item_record.master_metadata_album_artist_name || "未知歌手";
            const album = item_record.master_metadata_album_album_name || "未知專輯";
            const uri = item_record.spotify_track_uri || "未知URI";

            if (track !== "未知歌曲" && artist !== "未知歌手") {
                key_value = `${track} - ${artist}`;
            } else if (album !== "未知專輯" && artist !== "未知歌手") {
                key_value = `${album} - ${artist}`;
            } else {
                key_value = uri;
            }
        } else if (["shuffle", "skipped", "offline", "incognito_mode"].includes(field_to_rank_key)) {
            const raw_val = item_record[field_to_rank_key];
            if (raw_val === true) key_value = "是";
            else if (raw_val === false) key_value = "否";
            else key_value = "未知"; // null or other non-boolean values
        } else {
            key_value = item_record[field_to_rank_key] || "未知";
        }

        if (!item_metrics.has(key_value)) {
            item_metrics.set(key_value, { count: 0, total_ms: 0 });
        }
        const currentMetrics = item_metrics.get(key_value);
        const ms_played = getMsFromRecord(item_record.ms_played || 0);

        currentMetrics.count += 1;
        currentMetrics.total_ms += ms_played;
    }

    let ranked_list_tuples = [];
    for (const [item_data, metrics] of item_metrics.entries()) {
        const total_ms = metrics.total_ms;
        const count = metrics.count;
        const avg_ms = count > 0 ? total_ms / count : 0;

        let primary_metric_value = 0;
        if (rank_metric === "count") {
            primary_metric_value = count;
        } else if (rank_metric === "duration") {
            primary_metric_value = total_ms;
        } else if (rank_metric === "avg_duration") {
            primary_metric_value = avg_ms;
        }

        ranked_list_tuples.push([item_data, primary_metric_value, total_ms, count, avg_ms]);
    }

    // Sort logic: primary by primary_metric descending
    ranked_list_tuples.sort((a, b) => {
        // Primary sort: by primary_metric descending
        if (b[1] !== a[1]) {
            return b[1] - a[1];
        }
        // Secondary sort: by item_data (string or first part of combined string) ascending
        const itemA = a[0];
        const itemB = b[0];
        return String(itemA).localeCompare(String(itemB));
    });

    if (num_results_to_show_str.toLowerCase() === 'all') {
        return ranked_list_tuples;
    } else {
        const num_to_show = parseInt(num_results_to_show_str, 10);
        if (isNaN(num_to_show) || num_to_show <= 0) {
            // In a real app, you'd show a user-friendly error message here
            console.warn("顯示結果數量必須大於0或為 'all'。將顯示全部。");
            return ranked_list_tuples;
        }
        return ranked_list_tuples.slice(0, num_to_show);
    }
};

const analyzeTrendData = (data_list, trend_type_display, numResultsEntryValue) => {
    const monthly_data = new Map(); // Key: "YYYY-MM", Value: list of records for that month

    for (const record of data_list) {
        try {
            const dt_object = new Date(record.ts);
            const month_key = `${dt_object.getFullYear()}-${String(dt_object.getMonth() + 1).padStart(2, '0')}`;
            if (!monthly_data.has(month_key)) {
                monthly_data.set(month_key, []);
            }
            monthly_data.get(month_key).push(record);
        } catch (e) {
            console.warn(`跳過趨勢分析中無效時間戳的記錄: ${record.ts}`, e);
            continue;
        }
    }

    let results = [];
    const sorted_months = Array.from(monthly_data.keys()).sort();

    const TREND_ANALYSIS_TYPES_LOCAL = { // Renamed to avoid conflict with global constant
        monthly_total_duration: "每月總收聽時間",
        monthly_top_songs: "每月熱門歌曲",
        monthly_top_artists: "每月熱門歌手",
    };

    if (trend_type_display === TREND_ANALYSIS_TYPES_LOCAL["monthly_total_duration"]) {
        for (const month of sorted_months) {
            const total_ms = monthly_data.get(month).reduce((sum, r) => sum + getMsFromRecord(r.ms_played || 0), 0);
            results.push([month, formatMsToMinSec(total_ms), total_ms]); // (月份, 格式化時長, 原始毫秒)
        }
    } else if (trend_type_display === TREND_ANALYSIS_TYPES_LOCAL["monthly_top_songs"]) {
        const num_top_items = parseInt(numResultsEntryValue, 10) || 5; // Default to 5
        for (const month of sorted_months) {
            const monthly_ranked_songs = rankData(monthly_data.get(month), "master_metadata_track_name", String(num_top_items), "count");
            const top_songs_display = [];
            for (const [item_data, , , count] of monthly_ranked_songs) {
                const [song_name, artist_name] = item_data.split(' - ');
                top_songs_display.push(`${song_name} (${artist_name}) - ${count}次`);
            }
            results.push([month, top_songs_display.join("; ")]);
        }
    } else if (trend_type_display === TREND_ANALYSIS_TYPES_LOCAL["monthly_top_artists"]) {
        const num_top_items = parseInt(numResultsEntryValue, 10) || 5; // Default to 5
        for (const month of sorted_months) {
            const monthly_ranked_artists = rankData(monthly_data.get(month), "master_metadata_album_artist_name", String(num_top_items), "count");
            const top_artists_display = [];
            for (const [item_data, , , count] of monthly_ranked_artists) {
                const artist_name = item_data;
                top_artists_display.push(`${artist_name} - ${count}次`);
            }
            results.push([month, top_artists_display.join("; ")]);
        }
    }
    // Sort by month ascending is already handled by sorted_months
    return results;
};


// 定義可供排行的欄位及其對應的中文名稱
const FIELD_MAPPING = {
    1: ["master_metadata_track_name", "歌曲名稱 - 歌手"],
    2: ["master_metadata_album_artist_name", "歌手"],
    3: ["master_metadata_album_album_name", "專輯 - 歌手"],
    4: ["platform", "播放平台"],
    5: ["conn_country", "連線國家"],
    6: ["spotify_track_uri", "單曲 (URI)"],
    7: ["reason_start", "播放開始原因"],
    8: ["reason_end", "播放結束原因"],
    9: ["shuffle", "是否隨機播放"],
    10: ["skipped", "是否跳過"],
    11: ["offline", "是否離線播放"],
    12: ["incognito_mode", "是否隱身模式"],
    13: ["ms_played", "總播放時長"], // 新增：按總播放時長排行
};

// 趨勢分析類型
const TREND_ANALYSIS_TYPES = {
    "none": "無",
    "monthly_total_duration": "每月總收聽時間",
    "monthly_top_songs": "每月熱門歌曲",
    "monthly_top_artists": "每月熱門歌手",
};

const App = () => {
    const [currentPage, setCurrentPage] = useState('analyzer'); // 'analyzer', 'how-to-use', 'recap', 'recommendation'

    const [filePaths, setFilePaths] = useState([]);
    const [allStreamingDataOriginal, setAllStreamingDataOriginal] = useState([]);
    const [rankedItemsCache, setRankedItemsCache] = useState([]);
    const [currentlyDisplayedRankedItems, setCurrentlyDisplayedRankedItems] = useState([]);
    const [selectedFilesLabel, setSelectedFilesLabel] = useState("尚未選取檔案");
    const [progress, setProgress] = useState(0);
    const [status, setStatus] = useState("準備就緒");

    // Main analyzer date filter states
    const [dateFilterEnabled, setDateFilterEnabled] = useState(false);
    const [startDate, setStartDate] = useState("");
    const [endDate, setEndDate] = useState("");

    const [rankingField, setRankingField] = useState(FIELD_MAPPING[1][1]);
    const [numResults, setNumResults] = useState("all");
    const [rankMetric, setRankMetric] = useState("count"); // "count", "duration", "avg_duration"
    const [trendAnalysisType, setTrendAnalysisType] = useState("無"); // "無" or values from TREND_ANALYSIS_TYPES

    const [mainSearchTerm, setMainSearchTerm] = useState("");
    const [mainSearchEnabled, setMainSearchEnabled] = useState(true); // Control visibility of main search inputs

    const fileInputRef = useRef(null);
    const detailModalRef = useRef(null); // Ref for the detail modal
    const artistModalRef = useRef(null); // Ref for the artist modal

    // State for modal visibility and data
    const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
    const [detailRecords, setDetailRecords] = useState([]);
    const [detailModalTitle, setDetailModalTitle] = useState("");
    const [detailMaxPlayTimes, setDetailMaxPlayTimes] = useState({});
    const [detailSearchTerm, setDetailSearchTerm] = useState(""); // Search term for detail modal
    const [youtubeVideoId, setYoutubeVideoId] = useState(null); // New state for YouTube video ID
    const [youtubeLoading, setYoutubeLoading] = useState(false); // New state for YouTube loading

    const [isArtistModalOpen, setIsArtistModalOpen] = useState(false);
    const [artistName, setArtistName] = useState("");
    const [artistAlbumsData, setArtistAlbumsData] = useState([]);
    const [artistSongsData, setArtistSongsData] = useState([]);
    const allArtistRecordsFiltered = useRef([]); // To store all filtered records for the artist modal
    const [isArtistLoading, setIsArtistLoading] = useState(false); // New state for artist modal loading

    // State for Gemini API response modal
    const [isGeminiModalOpen, setIsGeminiModalOpen] = useState(false);
    const [geminiModalTitle, setGeminiModalTitle] = useState("");
    const [geminiModalContent, setGeminiModalContent] = useState("");
    const [isGeminiLoading, setIsGeminiLoading] = useState(false);

    // New state for recommendation choice modal
    const [isRecommendationChoiceModalOpen, setIsRecommendationChoiceModalOpen] = useState(false);
    // New state for recommendation data
    const [recommendationData, setRecommendationData] = useState(null);

    // Recap States (獨立於主分析器)
    const [recapData, setRecapData] = useState(null);
    const [isRecapLoading, setIsRecapLoading] = useState(false);
    const [isRecapDateSelectModalOpen, setIsRecapDateSelectModalOpen] = useState(false);
    // recapApplyAllData is still in App.js as it controls the high-level recap logic
    const [recapApplyAllData, setRecapApplyAllData] = useState(false); 


    // YouTube API Key (Hardcoded)
    const youtubeApiKey = "AIzaSyCAGNcELz80THkZrLa448pYpl0PzRraSfY";

    const getFieldKeyFromName = useCallback((displayName) => {
        for (const k in FIELD_MAPPING) {
            if (FIELD_MAPPING[k][1] === displayName) {
                return FIELD_MAPPING[k][0];
            }
        }
        return null;
    }, []);

    const currentFieldToRankKey = useMemo(() => getFieldKeyFromName(rankingField), [rankingField, getFieldKeyFromName]);

    const handleFileChange = async (event) => {
        const files = Array.from(event.target.files);
        setFilePaths(files);
        setSelectedFilesLabel(`已選取 ${files.length} 個檔案`);
        setStatus(`已選取 ${files.length} 個檔案`);
        setAllStreamingDataOriginal([]); // Clear previous data
        setRankedItemsCache([]);
        setCurrentlyDisplayedRankedItems([]);
        setProgress(0);
        setRecapData(null); // Clear recap data on new file selection
        setRecommendationData(null); // Clear recommendation data on new file selection
    };

    const loadAndCombineData = useCallback(async (files) => {
        let all_data = [];
        const total_files = files.length;

        for (let i = 0; i < total_files; i++) {
            const file = files[i];
            setStatus(`正在載入檔案 ${i + 1}/${total_files}: ${file.name}...`);
            setProgress(((i / total_files) * 100));

            try {
                const content = await file.text();
                if (!content.trim()) {
                    console.warn(`檔案 '${file.name}' 為空，將跳過此檔案。`);
                    continue;
                }
                const data = JSON.parse(content);
                if (Array.isArray(data)) {
                    const processedData = data.map(record => ({
                        ...record,
                        ms_played: getMsFromRecord(record.ms_played || 0),
                        master_metadata_track_name: record.master_metadata_track_name || '未知歌曲',
                        master_metadata_album_artist_name: record.master_metadata_album_artist_name || '未知歌手',
                        master_metadata_album_album_name: record.master_metadata_album_album_name || '未知專輯',
                        platform: record.platform || '未知平台',
                        conn_country: record.conn_country || '未知國家',
                        spotify_track_uri: record.spotify_track_uri || '未知URI',
                        shuffle: typeof record.shuffle === 'boolean' ? record.shuffle : null,
                        skipped: typeof record.skipped === 'boolean' ? record.skipped : null,
                        offline: typeof record.offline === 'boolean' ? record.offline : null,
                        incognito_mode: typeof record.incognito_mode === 'boolean' ? record.incognito_mode : null,
                    }));
                    all_data.push(...processedData);
                } else {
                    console.warn(`檔案 '${file.name}' 的格式不正確（應為JSON陣列），將跳過此檔案。`);
                }
            } catch (e) {
                console.error(`讀取檔案 '${file.name}' 時發生錯誤：`, e);
                alert(`錯誤：讀取檔案 '${file.name}' 時發生錯誤。請確認它是有效的 JSON 檔案。`);
                return null;
            }
        }
        setProgress(100);
        setStatus("檔案載入完成。");
        return all_data;
    }, []);

    const analyzeData = useCallback(async () => {
        setStatus("開始分析...");
        setProgress(0);

        if (filePaths.length === 0) {
            alert("請先選取 JSON 檔案。");
            setStatus("分析失敗：未選取檔案");
            return;
        }

        let currentStreamingData = allStreamingDataOriginal;
        if (currentStreamingData.length === 0) {
            currentStreamingData = await loadAndCombineData(filePaths);
            if (currentStreamingData === null) {
                setStatus("分析失敗：資料載入錯誤");
                return;
            }
            if (currentStreamingData.length === 0) {
                alert("載入的檔案中沒有有效的播放數據。");
                setStatus("分析完成：無數據");
                setCurrentlyDisplayedRankedItems([]);
                setRankedItemsCache([]);
                return;
            }
            setAllStreamingDataOriginal(currentStreamingData);
        }

        // Date filtering for main analyzer
        let currentStartDateObj = null;
        let currentEndDateObj = null;
        if (dateFilterEnabled) {
            currentStartDateObj = parseDateFromString(startDate);
            currentEndDateObj = parseDateFromString(endDate);

            if (startDate && !currentStartDateObj) {
                alert("開始日期格式錯誤。請使用YYYYMMDD 格式。");
                setStatus("分析失敗：開始日期錯誤");
                return;
            }
            if (endDate && !currentEndDateObj) {
                alert("結束日期格式錯誤。請使用YYYYMMDD 格式。");
                setStatus("分析失敗：結束日期錯誤");
                return;
            }
            if (currentStartDateObj && currentEndDateObj && currentStartDateObj > currentEndDateObj) {
                alert("開始日期不能晚於結束日期。");
                setStatus("分析失敗：日期順序錯誤");
                return;
            }
            if (currentStartDateObj && !currentEndDateObj) {
                alert("請輸入結束日期。");
                setStatus("分析失敗：缺少結束日期");
                return;
            }
            if (!currentStartDateObj && currentEndDateObj) {
                alert("請輸入開始日期。");
                setStatus("分析失敗：缺少開始日期");
                return;
            }
        }

        setStatus("正在篩選資料...");
        const dataToProcess = filterDataByDate(currentStreamingData, currentStartDateObj, currentEndDateObj);

        if (dataToProcess.length === 0) {
            let dateRangeMsg = "";
            if (currentStartDateObj && currentEndDateObj) {
                dateRangeMsg = ` (日期範圍: ${currentStartDateObj.toLocaleDateString()} 至 ${currentEndDateObj.toLocaleDateString()})`;
            }
            alert(`在指定的條件下${dateRangeMsg}沒有找到任何播放記錄。`);
            setStatus("分析完成：篩選後無數據");
            setCurrentlyDisplayedRankedItems([]);
            setRankedItemsCache([]);
            return;
        }

        // Trend analysis logic
        if (trendAnalysisType !== "無") {
            setStatus(`正在進行趨勢分析 (${trendAnalysisType})...`);
            const trendResults = analyzeTrendData(dataToProcess, trendAnalysisType, numResults);
            setCurrentlyDisplayedRankedItems(trendResults);
            setRankedItemsCache(trendResults); // Cache trend results
            setStatus(`趨勢分析完成！共 ${trendResults.length} 項結果。`);
            return;
        }

        // Regular ranking logic
        if (!currentFieldToRankKey) {
            alert("無效的排行項目選擇。");
            setStatus("分析失敗：排行項目錯誤");
            return;
        }

        setStatus("正在進行排行統計...");
        const rankedItems = rankData(dataToProcess, currentFieldToRankKey, numResults, rankMetric);
        setRankedItemsCache(rankedItems);
        setCurrentlyDisplayedRankedItems(rankedItems);
        setMainSearchTerm(""); // Clear main search on new analysis

        if (rankedItems.length > 0) {
            setStatus(`分析完成！共 ${rankedItems.length} 項結果。`);
        } else {
            setStatus("分析完成：排行後無結果。");
            alert(`根據所選條件，'${rankingField}' 沒有可排行的數據。`);
        }
        setProgress(100);
    }, [filePaths, allStreamingDataOriginal, loadAndCombineData, dateFilterEnabled, startDate, endDate, trendAnalysisType, currentFieldToRankKey, numResults, rankMetric, rankingField]);


    const resetAppState = () => {
        setFilePaths([]);
        setAllStreamingDataOriginal([]);
        setRankedItemsCache([]);
        setCurrentlyDisplayedRankedItems([]);
        setSelectedFilesLabel("尚未選取檔案");
        setProgress(0);
        setStatus("準備就緒");
        setDateFilterEnabled(false);
        setStartDate("");
        setEndDate("");
        setRankingField(FIELD_MAPPING[1][1]);
        setNumResults("all");
        setRankMetric("count");
        setTrendAnalysisType("無");
        setMainSearchTerm("");
        setRecapData(null); // Clear recap data on reset
        // The recapModalStartDate and recapModalEndDate are now local to RecapDateSelectModal, no need to reset here
        setRecapApplyAllData(false);
        setRecommendationData(null); // Clear recommendation data on reset
        // Reset search widgets state based on default ranking field
        setMainSearchEnabled(true); // Assuming '歌曲名稱 - 歌手' is default and supports search
        alert("應用程式狀態已重設。");
    };

    const filterMainResults = useCallback(() => {
        if (!rankedItemsCache.length) {
            return;
        }

        const searchTermLower = mainSearchTerm.toLowerCase();
        if (!searchTermLower) {
            setCurrentlyDisplayedRankedItems(rankedItemsCache);
            return;
        }

        const filteredItems = rankedItemsCache.filter(item => {
            const itemData = item[0];
            if (typeof itemData === 'string') {
                return itemData.toLowerCase().includes(searchTermLower);
            }
            // For combined fields like "歌曲名稱 - 歌手" or "專輯 - 歌手"
            if (Array.isArray(itemData) && itemData.length === 2) {
                return itemData[0].toLowerCase().includes(searchTermLower) || itemData[1].toLowerCase().includes(searchTermLower);
            }
            return false;
        });

        setCurrentlyDisplayedRankedItems(filteredItems);
        setStatus(`主列表搜尋完成，找到 ${filteredItems.length} 項結果。`);
    }, [mainSearchTerm, rankedItemsCache]);

    const clearMainSearch = () => {
        setMainSearchTerm("");
        setCurrentlyDisplayedRankedItems(rankedItemsCache);
        setStatus(`主列表搜尋已清除。顯示 ${rankedItemsCache.length} 項結果。`);
    };

    const handleRankingFieldChange = (e) => {
        const selectedField = e.target.value;
        setRankingField(selectedField);
        // Determine if main search should be enabled based on selected field
        const fieldKey = getFieldKeyFromName(selectedField);
        const shouldEnableSearch = ["master_metadata_track_name", "master_metadata_album_album_name"].includes(fieldKey) && trendAnalysisType === "無";
        setMainSearchEnabled(shouldEnableSearch);

        // If main search was enabled and is now disabled, clear the search term and restore all cached items
        if (!shouldEnableSearch && mainSearchTerm) {
            setMainSearchTerm("");
            setCurrentlyDisplayedRankedItems(rankedItemsCache);
        }
    };

    const handleTrendAnalysisChange = (e) => {
        const selectedTrend = e.target.value;
        setTrendAnalysisType(selectedTrend);

        // If trend analysis is selected, disable regular ranking options and main search
        if (selectedTrend !== "無") {
            setRankingField(FIELD_MAPPING[1][1]); // Reset to default for consistency
            setRankMetric("count"); // Reset
            setMainSearchEnabled(false);
        } else {
            // Re-enable based on the currently selected ranking field
            const fieldKey = getFieldKeyFromName(rankingField);
            setMainSearchEnabled(["master_metadata_track_name", "master_metadata_album_album_name"].includes(fieldKey));
        }
    };


    const openExternalLink = (url) => {
        window.open(url, '_blank');
        setStatus(`已在瀏覽器中開啟: ${url}`);
    };

    const searchLyricsOnline = useCallback((songName, artistName) => {
        const searchQuery = `${songName} ${artistName} 歌詞`;
        openExternalLink(`https://www.google.com/search?q=${encodeURIComponent(searchQuery)}`);
    }, []);

    const searchAlbumReviewOnline = useCallback((albumName, artistName) => {
        const searchQuery = `${albumName} ${artistName} 專輯評價`;
        openExternalLink(`https://www.google.com/search?q=${encodeURIComponent(searchQuery)}`);
    }, []);

    const searchArtistBioOnline = useCallback((artistName) => {
        openExternalLink(`https://www.google.com/search?q=${encodeURIComponent(artistName + " 維基百科")}`);
    }, []);

    const searchYoutubeMV = useCallback(async (songName, artistName) => {
        if (!youtubeApiKey) {
            // This should not happen since the key is hardcoded now.
            // But keep for robustness.
            alert("YouTube API 金鑰缺失。請聯絡應用程式提供者。");
            return null;
        }

        setYoutubeLoading(true);
        setYoutubeVideoId(null); // Clear previous video

        const query = `${songName} ${artistName} official MV`;
        const YOUTUBE_API_URL = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(query)}&type=video&key=${youtubeApiKey}&maxResults=1`;

        try {
            const response = await fetch(YOUTUBE_API_URL);
            const data = await response.json();

            if (data.items && data.items.length > 0) {
                const videoId = data.items[0].id.videoId;
                setYoutubeVideoId(videoId);
                setStatus(`找到並載入 MV: ${songName} by ${artistName}`);
                return videoId;
            } else {
                setYoutubeVideoId(null);
                // No alert here, handled by UI.
                setStatus(`找不到 MV: ${songName} by ${artistName}`);
                return null;
            }
        } catch (error) {
            console.error("搜尋 YouTube MV 時發生錯誤:", error);
            setYoutubeVideoId(null);
            alert(`搜尋 YouTube MV 時發生錯誤：${error.message}`);
            setStatus(`YouTube MV 搜尋錯誤: ${error.message}`);
            return null;
        } finally {
            setYoutubeLoading(false);
        }
    }, [youtubeApiKey]);


    const callGeminiAPI = useCallback(async (prompt, title, isStructured = false, schema = null, targetPageState = null) => {
        setIsGeminiLoading(true);
        setGeminiModalTitle(title);
        setGeminiModalContent("正在生成內容，請稍候...");
        setIsGeminiModalOpen(true);

        try {
            let chatHistory = [];
            chatHistory.push({ role: "user", parts: [{ text: prompt }] });
            
            const payload = { contents: chatHistory };
            if (isStructured && schema) {
                payload.generationConfig = {
                    responseMimeType: "application/json",
                    responseSchema: schema
                };
            }

            // Canvas will automatically provide the API key at runtime if left as an empty string.
            // DO NOT ADD any API key validation.
            const apiKey = "AIzaSyB4Wwf3gkNsySR6jugfRqiMEK5pt5JDXqs"; 
            const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const result = await response.json();

            let extractedText = "";
            let errorDetails = null;

            if (result.candidates && result.candidates.length > 0 &&
                result.candidates[0].content && result.candidates[0].content.parts &&
                result.candidates[0].content.parts.length > 0 &&
                typeof result.candidates[0].content.parts[0].text === 'string') {
                extractedText = result.candidates[0].content.parts[0].text;
            } else if (result.error) {
                errorDetails = result.error.message;
            }

            if (extractedText) { // Check if extractedText is not empty
                let textToDisplay = extractedText;
                if (isStructured) {
                    try {
                        const parsedJson = JSON.parse(extractedText);
                        // Store the parsed JSON based on title/targetPageState
                        if (targetPageState === 'recap') {
                            setRecapData(parsedJson);
                            setIsGeminiModalOpen(false); // Close generic modal if recap data loaded
                            setCurrentPage('recap'); // Switch to recap page
                            return; // Exit as we're handling recap data specifically
                        } else if (targetPageState === 'recommendation') {
                            setRecommendationData(parsedJson);
                            setIsGeminiModalOpen(false); // Close generic modal if recommendation data loaded
                            setCurrentPage('recommendation'); // Switch to recommendation page
                            return; // Exit as we're handling recommendation data specifically
                        }
                        textToDisplay = JSON.stringify(parsedJson, null, 2); // Pretty print for other structured responses
                    } catch (parseError) {
                        console.error("解析 Gemini 結構化輸出時發生錯誤:", parseError, "原始輸出:", extractedText);
                        textToDisplay = `解析錯誤：${parseError.message}\n原始輸出:\n${extractedText}`;
                    }
                }
                setGeminiModalContent(textToDisplay);
            } else {
                // More detailed error message based on what might be missing
                let errorMessage = "無法生成內容。";
                if (errorDetails) {
                    errorMessage += `API 錯誤訊息: ${errorDetails}`;
                } else if (result.candidates && result.candidates[0] && result.candidates[0].finishReason === "SAFETY") {
                    errorMessage = "內容因安全政策而被阻擋。請嘗試不同的提示。";
                }
                else if (!result.candidates || result.candidates.length === 0) {
                    errorMessage += "API 響應中缺少 'candidates'。";
                } else if (result.candidates[0] && (!result.candidates[0].content || !result.candidates[0].content.parts || result.candidates[0].content.parts.length === 0)) {
                    errorMessage += "API 響應中缺少預期的內容結構。";
                } else if (result.candidates[0] && result.candidates[0].content && result.candidates[0].content.parts && typeof result.candidates[0].content.parts[0].text !== 'string') {
                    errorMessage += "API 響應中 'text' 內容格式不正確。";
                } else {
                    errorMessage += "API 響應的 'text' 內容為空。";
                }
                setGeminiModalContent(errorMessage);
                console.error("Gemini API 響應錯誤或內容缺失:", result);
            }
        } catch (error) {
            setGeminiModalContent(`生成內容時發生錯誤: ${error.message}`);
            console.error("調用 Gemini API 時發生錯誤:", error);
        } finally {
            setIsGeminiLoading(false);
        }
    }, []);

    const showArtistHierarchyWindow = useCallback(async (artistNameClicked) => {
        setIsArtistLoading(true); // 開始載入
        setArtistName(artistNameClicked);
        allArtistRecordsFiltered.current = []; // 清除之前的過濾記錄
        setIsArtistModalOpen(true); // 立即開啟模態視窗，顯示載入指示器

        // 使用 setTimeout 讓 loading state 有時間更新，避免 UI 阻塞
        setTimeout(() => {
            try {
                for (const record of allStreamingDataOriginal) {
                    if (record.master_metadata_album_artist_name === artistNameClicked) {
                        const recordDateStr = record.ts;
                        if (recordDateStr) {
                            try {
                                const recordDate = new Date(recordDateStr.substring(0, 10));
                                // Use main analyzer's date filter states
                                const startObj = dateFilterEnabled ? parseDateFromString(startDate) : null;
                                const endObj = dateFilterEnabled ? parseDateFromString(endDate) : null;

                                const start_date_normalized = startObj ? new Date(startObj.getFullYear(), startObj.getMonth(), startObj.getDate()) : null;
                                const end_date_normalized = endObj ? new Date(endObj.getFullYear(), endObj.getMonth(), endObj.getDate()) : null;
                                const item_date_normalized = new Date(recordDate.getFullYear(), recordDate.getMonth(), recordDate.getDate());

                                if ((!start_date_normalized || item_date_normalized >= start_date_normalized) &&
                                    (!end_date_normalized || item_date_normalized <= end_date_normalized)) {
                                    allArtistRecordsFiltered.current.push(record);
                                }
                            } catch (e) {
                                console.warn(`跳過歌手詳細中無效日期格式的記錄: ${recordDateStr}`, e);
                            }
                        }
                    }
                }

                if (allArtistRecordsFiltered.current.length === 0) {
                    // 如果沒有數據，關閉模態視窗並提示
                    setIsArtistModalOpen(false);
                    alert(`在目前的篩選條件下，沒有找到歌手 '${artistNameClicked}' 的收聽記錄。`);
                    return;
                }

                // Prepare album data
                const albumsDataMap = new Map(); // Key: albumName, Value: {count, total_ms, songs: Map<songName, {count, total_ms}>}
                const allSongsByArtistDataMap = new Map(); // Key: songName, Value: {count, total_ms, album: albumName}

                for (const record of allArtistRecordsFiltered.current) {
                    const albumName = record.master_metadata_album_album_name || "未知專輯";
                    const songName = record.master_metadata_track_name || "未知歌曲";
                    const msPlayed = getMsFromRecord(record.ms_played);

                    if (!albumsDataMap.has(albumName)) {
                        albumsDataMap.set(albumName, { count: 0, total_ms: 0, songs: new Map() });
                    }
                    const albumMetrics = albumsDataMap.get(albumName);
                    albumMetrics.count += 1;
                    albumMetrics.total_ms += msPlayed;

                    if (!albumMetrics.songs.has(songName)) {
                        albumMetrics.songs.set(songName, { count: 0, total_ms: 0 });
                    }
                    const songMetricsInAlbum = albumMetrics.songs.get(songName);
                    songMetricsInAlbum.count += 1;
                    songMetricsInAlbum.total_ms += msPlayed;

                    if (!allSongsByArtistDataMap.has(songName)) {
                        allSongsByArtistDataMap.set(songName, { count: 0, total_ms: 0, album: "未知專輯" });
                    }
                    const songMetricsOverall = allSongsByArtistDataMap.get(songName);
                    songMetricsOverall.count += 1;
                    songMetricsOverall.total_ms += msPlayed;
                    if (songMetricsOverall.album === "未知專輯") { // Set album only if not set yet
                        songMetricsOverall.album = albumName;
                    }
                }

                const sortedAlbums = Array.from(albumsDataMap.entries()).sort((a, b) => b[1].count - a[1].count);
                setArtistAlbumsData(sortedAlbums.map(([albumName, data]) => ({
                    albumName,
                    count: data.count,
                    totalDuration: formatMsToMinSec(data.total_ms),
                    rawSongsData: data.songs // Store raw map for later use
                })));

                const sortedSongsOverall = Array.from(allSongsByArtistDataMap.entries()).sort((a, b) => b[1].count - a[1].count);
                setArtistSongsData(sortedSongsOverall.map(([songName, data]) => ({
                    songName,
                    albumName: data.album,
                    count: data.count,
                    totalDuration: formatMsToMinSec(data.total_ms)
                })));

            } finally {
                setIsArtistLoading(false); // 結束載入
            }
        }, 10); // 短暫延遲以允許 UI 更新 loading state
    }, [allStreamingDataOriginal, dateFilterEnabled, startDate, endDate]);


    const triggerGeminiAnalysis = useCallback(() => {
        if (!currentlyDisplayedRankedItems.length) {
            alert("沒有可供分析的排行結果。請先載入數據並執行分析。");
            return;
        }

        let dataSummary = "以下是我的 Spotify 播放記錄分析結果：\n\n";
        dataSummary += `當前排行項目: ${rankingField}\n`;
        dataSummary += `排行標準: ${rankMetric}\n\n`;

        dataSummary += "排行前 20 項數據 (項目, 主要指標值, 總播放時長, 播放次數, 平均播放時長):\n";
        currentlyDisplayedRankedItems.slice(0, 20).forEach((item, index) => {
            const item_data = item[0] || 'N/A';
            const primary_metric_val = item[1] || 0;
            const total_ms_val = item[2] || 0;
            const count_val = item[3] || 0;
            const avg_ms_val = item[4] || 0;
            dataSummary += `${index + 1}. ${item_data} | ${primary_metric_val} | ${formatMsToMinSec(total_ms_val)} | ${count_val}次 | ${formatMsToMinSec(avg_ms_val)}\n`;
        });

        const prompt = `根據以下的 Spotify 播放記錄分析結果，請提供關於我的收聽習慣和可能的曲風偏好的綜合分析。請用中文回應，並保持在 200 字以內，著重於提供洞察而非僅重複數據。\n\n${dataSummary}`;
        callGeminiAPI(prompt, "分析結果洞察");
    }, [currentlyDisplayedRankedItems, rankingField, rankMetric, callGeminiAPI]);


    const handlePlaylistRecommendation = useCallback(async (type) => {
        setIsRecommendationChoiceModalOpen(false); // Close the choice modal

        if (allStreamingDataOriginal.length === 0) {
            alert("請先載入您的 Spotify 播放記錄檔案才能生成推薦歌單。");
            return;
        }
        if (rankingField !== FIELD_MAPPING[1][1]) {
            alert("此功能僅在『排行項目』為『歌曲名稱 - 歌手』時可用。");
            return;
        }

        let playlistPrompt = "根據以下用戶的 Spotify 聽歌數據，請為我推薦 30 首新的歌曲。請提供歌曲標題和藝術家。\n";
        
        playlistPrompt += "我的收聽數據摘要：\n";

        // 提取前10首歌曲的詳細信息
        const top10Songs = currentlyDisplayedRankedItems.slice(0, 10).map(item => {
            const [songArtist, , totalMs, count, ] = item;
            return `- ${songArtist || '未知歌曲'} (播放次數: ${count || 0}, 總時長: ${formatMsToMinSec(totalMs || 0)})`;
        }).join('\n');
        if (top10Songs) {
            playlistPrompt += `\n熱門歌曲 (前10名):\n${top10Songs}\n`;
        } else {
            playlistPrompt += "\n沒有熱門歌曲數據可供分析。\n";
        }

        // 提取播放時長最長的5位歌手
        const artistDurationMap = new Map();
        allStreamingDataOriginal.forEach(record => {
            const artist = record.master_metadata_album_artist_name || '未知歌手';
            const msPlayed = getMsFromRecord(record.ms_played || 0);
            artistDurationMap.set(artist, (artistDurationMap.get(artist) || 0) + msPlayed);
        });

        const top5ArtistsByDuration = Array.from(artistDurationMap.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([artist, totalMs]) => `- ${artist || '未知歌手'} (總時長: ${formatMsToMinSec(totalMs || 0)})`)
            .join('\n');

        if (top5ArtistsByDuration) {
            playlistPrompt += `\n播放時長最長的歌手 (前5名):\n${top5ArtistsByDuration}\n`;
        } else {
            playlistPrompt += "\n沒有足夠的歌手數據可供分析。\n";
        }

        // 考慮最近播放的幾首歌曲（如果數據允許）
        const recentPlays = allStreamingDataOriginal.slice(-5).reverse().map(record => {
            const track = record.master_metadata_track_name || '未知歌曲';
            const artist = record.master_metadata_album_artist_name || '未知歌手';
            return `- ${track} - ${artist}`;
        }).join('\n');

        if (recentPlays) {
            playlistPrompt += `\n最近播放的歌曲 (前5首):\n${recentPlays}\n`;
        }

        if (type === 'unheard') {
            playlistPrompt += `\n請避免推薦用戶已經非常熟悉的熱門歌曲 (基於其播放記錄的前300名最常播放歌曲的風格)。請推薦與上述音樂風格相似或基於這些資訊衍生的新歌。請確保推薦的歌曲是全新的聆聽體驗。`;
        } else { // type === 'random'
            playlistPrompt += "\n請推薦與上述音樂風格相似或基於這些資訊衍生的新歌。";
        }

        playlistPrompt += `\n\n請以繁體中文回應，並遵循以下 JSON 格式。請確保只輸出 JSON，不要有額外的文字或解釋。推薦的歌曲數量請為 30 首。
{
  "playlistTitle": "[推薦歌單的標題，例如：根據您的喜好推薦的歌單]",
  "recommendations": [
    { "song": "歌曲名稱1", "artist": "藝術家1" },
    { "song": "歌曲名稱2", "artist": "藝術家2" },
    // ... 更多歌曲
  ],
  "description": "[一段簡短的推薦說明，例如：根據您的收聽習慣和偏好，為您精選了這些新歌。]"
}`;

        const recommendationSchema = {
            type: "OBJECT",
            properties: {
                playlistTitle: { "type": "STRING" },
                recommendations: {
                    "type": "ARRAY",
                    "items": {
                        "type": "OBJECT",
                        "properties": {
                            "song": { "type": "STRING" },
                            "artist": { "type": "STRING" }
                        },
                        "propertyOrdering": ["song", "artist"]
                    }
                },
                "description": { "type": "STRING" }
            },
            "propertyOrdering": ["playlistTitle", "recommendations", "description"]
        };

        await callGeminiAPI(playlistPrompt, "Gemini 推薦歌單", true, recommendationSchema, 'recommendation');
    }, [rankingField, allStreamingDataOriginal, currentlyDisplayedRankedItems, callGeminiAPI]);


    const showListeningDetails = useCallback(async (itemIndex) => {
        if (!allStreamingDataOriginal.length) {
            return;
        }

        if (trendAnalysisType !== "無") {
            setStatus("趨勢分析結果不支援查看播放明細。");
            return;
        }

        if (itemIndex < 0 || itemIndex >= currentlyDisplayedRankedItems.length) {
            return;
        }

        const clickedItemTuple = currentlyDisplayedRankedItems[itemIndex];
        const clickedItemData = clickedItemTuple[0]; // (item_data, primary_metric, total_ms, count, avg_ms)

        // Reset YouTube video
        setYoutubeVideoId(null);
        setYoutubeLoading(false);

        // Handle artist hierarchy
        if (currentFieldToRankKey === "master_metadata_album_artist_name") {
            const artistNameClicked = String(clickedItemData);
            showArtistHierarchyWindow(artistNameClicked); // Call the now defined function
            return;
        }

        const tempRecordsForDetails = [];
        let songNameForMV = '';
        let artistNameForMV = '';

        for (const record of allStreamingDataOriginal) {
            let isMatch = false;
            if (currentFieldToRankKey === "spotify_track_uri") {
                if (record.spotify_track_uri === String(clickedItemData)) {
                    isMatch = true;
                }
            } else if (currentFieldToRankKey === "master_metadata_album_album_name") {
                if (typeof clickedItemData === 'string' && clickedItemData.includes(' - ')) {
                    const [albumToFind, artistToFind] = clickedItemData.split(' - ');
                    if (record.master_metadata_album_album_name === albumToFind &&
                        record.master_metadata_album_artist_name === artistToFind) {
                        isMatch = true;
                    }
                } else {
                    if (record.master_metadata_album_album_name === clickedItemData) { // Fallback for simple album name
                        isMatch = true;
                    }
                }
            } else if (currentFieldToRankKey === "master_metadata_track_name" ||
                currentFieldToRankKey === "ms_played") { // if ranking by total duration, still show song details
                if (typeof clickedItemData === 'string' && clickedItemData.includes(' - ')) {
                    const [trackToFind, artistToFind] = clickedItemData.split(' - ');
                    if (record.master_metadata_track_name === trackToFind &&
                        record.master_metadata_album_artist_name === artistToFind) {
                        isMatch = true;
                        songNameForMV = trackToFind;
                        artistNameForMV = artistToFind;
                    }
                } else { // Handle URI case for ms_played ranking if clickedItemData is a URI
                    if (record.spotify_track_uri === clickedItemData) {
                        isMatch = true;
                        // Try to get song/artist from the record itself if URI is the clicked item
                        songNameForMV = record.master_metadata_track_name || '';
                        artistNameForMV = record.master_metadata_album_artist_name || '';
                    }
                }
            } else if (currentFieldToRankKey === "platform") {
                if (record.platform === String(clickedItemData)) {
                    isMatch = true;
                }
            } else if (currentFieldToRankKey === "conn_country") {
                if (record.conn_country === String(clickedItemData)) {
                    isMatch = true;
                }
            } else if (currentFieldToRankKey === "reason_start") {
                if (record.reason_start === String(clickedItemData)) {
                    isMatch = true;
                }
            } else if (currentFieldToRankKey === "reason_end") {
                if (record.reason_end === String(clickedItemData)) {
                    isMatch = true;
                }
            } else if (["shuffle", "skipped", "offline", "incognito_mode"].includes(currentFieldToRankKey)) {
                // For boolean fields, clickedItemData will be "是" or "否"
                const bool_val = (String(clickedItemData) === "是");
                if (record[currentFieldToRankKey] === bool_val) {
                    isMatch = true;
                }
            }

            if (isMatch) {
                const recordDateStr = record.ts;
                if (recordDateStr) {
                    try {
                        const recordDate = new Date(recordDateStr.substring(0, 10)); // YYYY-MM-DD
                        
                        let shouldAddRecord = true;
                        if (dateFilterEnabled) { // Use main analyzer's date filter states
                            const startObj = parseDateFromString(startDate);
                            const endObj = parseDateFromString(endDate);

                            // Only proceed with date normalization if startObj and endObj are valid
                            if (startObj && endObj) {
                                const start_date_normalized = new Date(startObj.getFullYear(), startObj.getMonth(), startObj.getDate());
                                const end_date_normalized = new Date(endObj.getFullYear(), endObj.getMonth(), endObj.getDate());
                                const item_date_normalized = new Date(recordDate.getFullYear(), recordDate.getMonth(), recordDate.getDate());

                                if (!(item_date_normalized >= start_date_normalized && item_date_normalized <= end_date_normalized)) {
                                    shouldAddRecord = false;
                                }
                            } else {
                                // If date filter is enabled but dates are invalid, don't add record
                                shouldAddRecord = false;
                            }
                        }

                        if (shouldAddRecord) {
                            tempRecordsForDetails.push(record);
                        }
                    } catch (e) {
                        console.warn(`跳過詳細記錄中無效日期格式的記錄: ${recordDateStr}`, e);
                    }
                }
            }
        }

        if (tempRecordsForDetails.length === 0) {
            alert(`在目前的篩選條件下，沒有找到 '${String(clickedItemData)}' 的詳細收聽記錄。`);
            return;
        }

        const maxPlayTimesForDetails = {};
        for (const rec of tempRecordsForDetails) {
            const uri = rec.spotify_track_uri;
            const ms = getMsFromRecord(rec.ms_played);
            if (uri) {
                maxPlayTimesForDetails[uri] = Math.max(maxPlayTimesForDetails[uri] || 0, ms);
            }
        }

        let detailsTitle = "詳細收聽記錄";
        if (currentFieldToRankKey === "spotify_track_uri") {
            detailsTitle = `單曲詳細記錄: ${String(clickedItemData)}`;
        } else if (currentFieldToRankKey === "master_metadata_album_album_name") {
            if (typeof clickedItemData === 'string' && clickedItemData.includes(' - ')) {
                const [albumName, artistName] = clickedItemData.split(' - ');
                detailsTitle = `專輯 '${albumName}' (${artistName}) 詳細記錄`;
            } else {
                detailsTitle = `專輯 '${String(clickedItemData)}' 詳細記錄`;
            }
        } else if (currentFieldToRankKey === "master_metadata_track_name") {
            if (typeof clickedItemData === 'string' && clickedItemData.includes(' - ')) {
                const [songName, artistName] = clickedItemData.split(' - ');
                detailsTitle = `歌曲 '${songName}' (${artistName}) 詳細記錄`;
            } else {
                detailsTitle = `單曲詳細記錄: ${String(clickedItemData)}`;
            }
        } else if (currentFieldToRankKey === "ms_played") {
            if (typeof clickedItemData === 'string' && clickedItemData.includes(' - ')) {
                const [songName, artistName] = clickedItemData.split(' - ');
                detailsTitle = `歌曲 '${songName}' (${artistName}) 詳細記錄`;
            } else {
                detailsTitle = `單曲詳細記錄: ${String(clickedItemData)}`;
            }
        } else if (currentFieldToRankKey === "platform") {
             detailsTitle = `平台 '${String(clickedItemData)}' 詳細記錄`;
        } else if (currentFieldToRankKey === "conn_country") {
             detailsTitle = `國家 '${String(clickedItemData)}' 詳細記錄`;
        } else if (currentFieldToRankKey === "reason_start") {
             detailsTitle = `開始原因 '${String(clickedItemData)}' 詳細記錄`;
        } else if (currentFieldToRankKey === "reason_end") {
             detailsTitle = `結束原因 '${String(clickedItemData)}' 詳細記錄`;
        } else if (["shuffle", "skipped", "offline", "incognito_mode"].includes(currentFieldToRankKey)) {
             detailsTitle = `${FIELD_MAPPING[Object.keys(FIELD_MAPPING).find(key => FIELD_MAPPING[key][0] === currentFieldToRankKey)][1]} '${String(clickedItemData)}' 詳細記錄`;
        }


        setDetailRecords(tempRecordsForDetails);
        setDetailModalTitle(detailsTitle);
        setDetailMaxPlayTimes(maxPlayTimesForDetails);
        setDetailSearchTerm(""); // Clear search when opening new modal
        setIsDetailModalOpen(true);

        // Immediately search for MV if it's a song/track URI
        if (songNameForMV && artistNameForMV && (currentFieldToRankKey === "master_metadata_track_name" || currentFieldToRankKey === "ms_played" || currentFieldToRankKey === "spotify_track_uri")) {
            searchYoutubeMV(songNameForMV, artistNameForMV);
        }

    }, [allStreamingDataOriginal, currentlyDisplayedRankedItems, currentFieldToRankKey, dateFilterEnabled, startDate, endDate, trendAnalysisType, showArtistHierarchyWindow, searchYoutubeMV]);


    const handleArtistAlbumSelect = useCallback((albumName) => {
        const selectedAlbum = artistAlbumsData.find(album => album.albumName === albumName);
        if (selectedAlbum && selectedAlbum.rawSongsData) {
            const songsInSelectedAlbum = Array.from(selectedAlbum.rawSongsData.entries()).sort((a, b) => b[1].count - a[1].count);
            setArtistSongsData(songsInSelectedAlbum.map(([songName, data]) => ({
                songName,
                albumName: albumName,
                count: data.count,
                totalDuration: formatMsToMinSec(data.total_ms)
            })));
        }
    }, [artistAlbumsData]);

    const handleArtistSongDoubleClick = useCallback(async (songNameClicked, /* albumNameContext */) => {
        const songSpecificRecords = allArtistRecordsFiltered.current.filter(record =>
            record.master_metadata_track_name === songNameClicked &&
            record.master_metadata_album_artist_name === artistName // Use the current artistName from state
        );

        if (songSpecificRecords.length === 0) {
            alert(`沒有找到歌曲 '${songNameClicked}' 的詳細播放記錄。`);
            return;
        }

        const maxPlayTimesForSong = {};
        for (const rec of songSpecificRecords) {
            const uri = rec.spotify_track_uri;
            const ms = getMsFromRecord(rec.ms_played);
            if (uri) {
                maxPlayTimesForSong[uri] = Math.max(maxPlayTimesForSong[uri] || 0, ms);
            }
        }

        const detailsTitle = `歌曲詳細記錄: ${songNameClicked} (${artistName})`;
        setDetailRecords(songSpecificRecords);
        setDetailModalTitle(detailsTitle);
        setDetailMaxPlayTimes(maxPlayTimesForSong);
        setDetailSearchTerm("");
        setIsDetailModalOpen(true);

        // Search MV when double-clicking a song in artist modal
        await searchYoutubeMV(songNameClicked, artistName);

    }, [artistName, searchYoutubeMV]); // artistName is from the parent modal state


    const exportToCsv = useCallback(() => {
        if (!currentlyDisplayedRankedItems.length) {
            alert("沒有可匯出的數據。");
            return;
        }

        let dateSuffix = "";
        if (dateFilterEnabled && startDate && endDate) {
            dateSuffix = `_${startDate}-${endDate}`;
        }

        let filenamePrefix = "ranked_results";
        let csvHeaderBase = [];
        let dataRows = [];

        if (trendAnalysisType !== "無") {
            const trendTypeDisplay = trendAnalysisType; // already localized
            if (trendTypeDisplay === TREND_ANALYSIS_TYPES.monthly_total_duration) {
                csvHeaderBase = ["月份", "總收聽時長(分:秒)", "總收聽時長(毫秒)"];
                filenamePrefix = "monthly_total_duration";
                dataRows = currentlyDisplayedRankedItems.map(row => [row[0], row[1], row[2]]);
            } else if (trendTypeDisplay === TREND_ANALYSIS_TYPES.monthly_top_songs) {
                csvHeaderBase = ["月份", "熱門歌曲"];
                filenamePrefix = "monthly_top_songs";
                dataRows = currentlyDisplayedRankedItems.map(row => [row[0], row[1]]);
            } else if (trendTypeDisplay === TREND_ANALYSIS_TYPES.monthly_top_artists) {
                csvHeaderBase = ["月份", "熱門歌手"];
                filenamePrefix = "monthly_top_artists";
                dataRows = currentlyDisplayedRankedItems.map(row => [row[0], row[1]]);
            }
        } else {
            let rankMetricHeader = "次數(Count)";
            if (rankMetric === "duration") {
                rankMetricHeader = "總播放時長(Total Duration)";
            } else if (rankMetric === "avg_duration") {
                rankMetricHeader = "平均播放時長(Avg Duration)";
            }
            const avgDurationHeader = "平均播放時長(Avg Duration)";

            const currentFieldNameChinese = FIELD_MAPPING[Object.keys(FIELD_MAPPING).find(key => FIELD_MAPPING[key][1] === rankingField)][1];

            if (currentFieldToRankKey === "master_metadata_track_name") {
                filenamePrefix = "song_artist_ranking";
                csvHeaderBase = ["排名(Rank)", "歌曲名稱", "歌手", rankMetricHeader, "總播放時長", avgDurationHeader];
            } else if (currentFieldToRankKey === "master_metadata_album_album_name") {
                filenamePrefix = "album_artist_ranking";
                csvHeaderBase = ["排名(Rank)", "專輯名稱", "歌手", rankMetricHeader, "總播放時長", avgDurationHeader];
            } else if (currentFieldToRankKey === "spotify_track_uri") {
                filenamePrefix = "track_uri_ranking";
                csvHeaderBase = ["排名(Rank)", "單曲 (URI)", rankMetricHeader, "總播放時長", avgDurationHeader];
            } else if (currentFieldToRankKey === "master_metadata_album_artist_name") { // Artist
                filenamePrefix = "artist_ranking";
                csvHeaderBase = ["排名(Rank)", "歌手", rankMetricHeader, "總播放時長", avgDurationHeader];
            } else if (currentFieldToRankKey === "ms_played") { // Ranking by total play duration
                filenamePrefix = "total_duration_ranking";
                csvHeaderBase = ["排名(Rank)", "歌曲/專輯/URI", "總播放時長", "播放次數", "平均播放時長"];
            } else { // Other general fields
                const itemHeaderName = currentFieldNameChinese.split(" - ")[0];
                filenamePrefix = `${itemHeaderName.toLowerCase().replace(/[^a-z0-9_]/g, '')}_ranking`; // Clean special chars
                csvHeaderBase = ["排名(Rank)", itemHeaderName, rankMetricHeader, "總播放時長", avgDurationHeader];
            }

            currentlyDisplayedRankedItems.forEach((item, i) => {
                const rankNum = i + 1;
                const [item_data, primary_metric_val, total_ms_val, count_val, avg_ms_val] = item;

                let primaryMetricDisplay = primary_metric_val;
                if (rankMetric === "duration" || rankMetric === "avg_duration") {
                    primaryMetricDisplay = formatMsToMinSec(primary_metric_val);
                }

                const totalDurationStrVal = formatMsToMinSec(total_ms_val);
                const avgDurationStrVal = formatMsToMinSec(avg_ms_val);

                let row_data = [rankNum];
                if (currentFieldToRankKey === "master_metadata_track_name" ||
                    currentFieldToRankKey === "master_metadata_album_album_name") {
                    if (typeof item_data === 'string' && item_data.includes(' - ')) { // (Song/Album, Artist)
                        const [name, artist] = item_data.split(' - ');
                        row_data.push(name, artist, primaryMetricDisplay, totalDurationStrVal, avgDurationStrVal);
                    } else { // Fallback for unexpected item_data format
                        row_data.push(String(item_data), "N/A", primaryMetricDisplay, totalDurationStrVal, avgDurationStrVal);
                    }
                } else if (currentFieldToRankKey === "spotify_track_uri" || currentFieldToRankKey === "master_metadata_album_artist_name") {
                    row_data.push(String(item_data), primaryMetricDisplay, totalDurationStrVal, avgDurationStrVal);
                } else { // Single item (platform, country, reason, etc.) or ms_played
                    row_data.push(String(item_data), primaryMetricDisplay, totalDurationStrVal, avgDurationStrVal);
                }
                dataRows.push(row_data);
            });
        }

        const finalHeader = [...csvHeaderBase];
        if (dateFilterEnabled && startDate && endDate) {
            finalHeader.push(`篩選日期範圍: ${startDate} 至 ${endDate}`);
        }

        const csvContent = [
            finalHeader.map(header => `"${header.replace(/"/g, '""')}"`).join(','),
            ...dataRows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
        ].join('\n');

        const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csvContent], { type: 'text/csv;charset=utf-8;' }); // Add BOM for UTF-8 in Excel
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${filenamePrefix}${dateSuffix}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        setStatus("CSV 已成功匯出。");
        alert("排行結果已成功匯出。");
    }, [currentlyDisplayedRankedItems, dateFilterEnabled, startDate, endDate, trendAnalysisType, rankingField, rankMetric, currentFieldToRankKey]);


    const exportDetailRecordsToCsv = useCallback((recordsToDisplay, title, currentMaxPlayTimes) => {
        if (!recordsToDisplay.length) {
            alert("沒有可匯出的詳細記錄。");
            return;
        }

        const safeTitle = title.replace(/[^a-zA-Z0-9\s-_\u4e00-\u9fa5]/g, '').trim(); // Keep Chinese chars
        const defaultFilename = `${safeTitle}_詳細記錄.csv`;

        const csvHeader = ["播放時間 (UTC)", "平台", "播放時長 (分:秒)", "歌曲名稱", "歌手", "專輯名稱",
            "播放完整度(%)", "開始原因", "結束原因", "隨機播放", "是否跳過", "離線播放", "隱身模式"];

        const dataRows = recordsToDisplay.map(record => {
            const ts = record.ts || 'N/A';
            const platform = record.platform || 'N/A';
            const ms_played_raw = record.ms_played || 0;
            const track_name = record.master_metadata_track_name || 'N/A';
            const artist_name = record.master_metadata_album_artist_name || 'N/A';
            const album_name = record.master_metadata_album_album_name || 'N/A';
            const uri = record.spotify_track_uri;

            const reason_start = record.reason_start || 'N/A';
            const reason_end = record.reason_end || 'N/A';
            const shuffle = record.shuffle === true ? "是" : (record.shuffle === false ? "否" : "N/A");
            const skipped = record.skipped === true ? "是" : (record.skipped === false ? "否" : "N/A");
            const offline = record.offline === true ? "是" : (record.offline === false ? "否" : "N/A");
            const incognito_mode = record.incognito_mode === true ? "是" : (record.incognito_mode === false ? "否" : "N/A");

            const ms_played_int = getMsFromRecord(ms_played_raw);
            const formatted_duration = formatMsToMinSec(ms_played_int);

            // For simplicity in web, calculate percentage only if currentMaxPlayTimes is available for that URI
            let play_completion_percentage = "N/A";
            if (currentMaxPlayTimes && uri && currentMaxPlayTimes[uri] > 0) {
                const percentage = (ms_played_int / currentMaxPlayTimes[uri]) * 100;
                play_completion_percentage = `${percentage.toFixed(1)}%`;
            }

            return [
                ts, platform, formatted_duration, track_name, artist_name, album_name,
                play_completion_percentage,
                reason_start, reason_end, shuffle, skipped, offline, incognito_mode
            ];
        });

        const csvContent = [
            csvHeader.map(header => `"${header.replace(/"/g, '""')}"`).join(','),
            ...dataRows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
        ].join('\n');

        const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = defaultFilename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        setStatus("詳細記錄已成功匯出。");
        alert("詳細記錄已成功匯出。");
    }, []);


    // Effect to manage main search input state
    useEffect(() => {
        const fieldKey = getFieldKeyFromName(rankingField);
        const shouldEnableSearch = ["master_metadata_track_name", "master_metadata_album_album_name"].includes(fieldKey) && trendAnalysisType === "無";
        setMainSearchEnabled(shouldEnableSearch);
    }, [rankingField, trendAnalysisType, getFieldKeyFromName]);

    // Recap Functionality - now triggered by RecapDateSelectModal
    const handleRecapGeneration = useCallback(async (selectedStartDate, selectedEndDate) => { // Receive dates as arguments
        setIsRecapDateSelectModalOpen(false); // Close the date selection modal
        
        if (allStreamingDataOriginal.length === 0) {
            alert("請先載入您的 Spotify 播放記錄檔案才能生成回顧。");
            return;
        }

        setIsRecapLoading(true);
        setRecapData(null); // Clear previous recap data

        let dataToAnalyze = allStreamingDataOriginal;
        let periodSummary = "所有時間";

        // Apply date filter if not 'applyAllDataFlag'
        if (!recapApplyAllData) { // Use recap's independent state
            const currentStartDateObj = parseDateFromString(selectedStartDate); 
            const currentEndDateObj = parseDateFromString(selectedEndDate); 

            if (!currentStartDateObj || !currentEndDateObj) {
                alert("請確保開始日期和結束日期格式正確 (YYYYMMDD)。");
                setIsRecapLoading(false);
                return;
            }
            if (currentStartDateObj > currentEndDateObj) {
                alert("回顧的開始日期不能晚於結束日期。");
                setIsRecapLoading(false);
                return;
            }

            dataToAnalyze = filterDataByDate(allStreamingDataOriginal, currentStartDateObj, currentEndDateObj);
            if (dataToAnalyze.length === 0) {
                alert("在指定的日期範圍內沒有找到播放記錄，無法生成回顧。");
                setIsRecapLoading(false);
                return;
            }
            periodSummary = `${currentStartDateObj.toLocaleDateString()} 至 ${currentEndDateObj.toLocaleDateString()}`;
        }
        // If recapApplyAllData is true, dataToAnalyze remains allStreamingDataOriginal, and periodSummary remains "所有時間"


        // Aggregate data for Gemini
        let totalMsPlayed = 0;
        const dailyMsPlayed = new Map(); // Date -> total ms
        const songPlayCounts = new Map(); // "Song - Artist" -> count
        const artistPlayCounts = new Map(); // "Artist" -> count
        // const albumPlayCounts = new Map(); // "Album - Artist" -> count // Not used in recap, can remove

        for (const record of dataToAnalyze) {
            const ms = getMsFromRecord(record.ms_played || 0);
            totalMsPlayed += ms;

            // Daily Stats
            const dateOnly = record.ts ? record.ts.substring(0, 10) : 'N/A';
            dailyMsPlayed.set(dateOnly, (dailyMsPlayed.get(dateOnly) || 0) + ms);

            // Song, Artist, Album counts
            const songName = record.master_metadata_track_name || '未知歌曲';
            const artistName = record.master_metadata_album_artist_name || '未知歌手';
            // const albumName = record.master_metadata_album_album_name || '未知專輯'; // Not used in recap, can remove

            const songKey = `${songName} - ${artistName}`;
            songPlayCounts.set(songKey, (songPlayCounts.get(songKey) || 0) + 1);

            artistPlayCounts.set(artistName, (artistPlayCounts.get(artistName) || 0) + 1);

            // const albumKey = `${albumName} - ${artistName}`; // Not used in recap, can remove
            // albumPlayCounts.set(albumKey, (albumPlayCounts.get(albumKey) || 0) + 1); // Not used in recap, can remove
        }

        // Find biggest listening day
        let biggestListeningDay = 'N/A';
        let maxDailyMs = 0;
        for (const [date, ms] of dailyMsPlayed.entries()) {
            if (ms > maxDailyMs) {
                maxDailyMs = ms;
                biggestListeningDay = date;
            }
        }

        // Top Songs
        const sortedSongs = Array.from(songPlayCounts.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([songArtist, count], index) => ({ rank: index + 1, song: songArtist.split(' - ')[0], artist: songArtist.split(' - ')[1], count: count }));

        // Top Artists
        const sortedArtists = Array.from(artistPlayCounts.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([artist, count], index) => ({ rank: index + 1, name: artist, count: count }));

        // Prepare prompt for Gemini
        // Conditional handling for totalMinutesListenedCard
        const totalMinutesCardValue = recapApplyAllData ? "N/A" : Math.floor(totalMsPlayed / 60000).toLocaleString();
        const totalMinutesCardUnit = recapApplyAllData ? "" : "分鐘";
        const totalMinutesCardSubText = recapApplyAllData ? "此回顧針對所有可用資料，總收聽時長在此不顯示。" : "這是您在這段時間內收聽音樂的總時長。";
        const biggestListeningDayMinutes = recapApplyAllData ? "N/A" : Math.floor(maxDailyMs / 60000).toLocaleString();
        const biggestListeningDayDate = recapApplyAllData ? "N/A" : biggestListeningDay;


        const prompt = `請根據以下 Spotify 播放記錄數據，為用戶生成一個音樂回顧（Recap）。請分析並總結用戶在該期間的音樂習慣、偏好和主要發現。請以繁體中文回應，並遵循以下 JSON 格式。請確保只輸出 JSON，不要有額外的文字或解釋。
數據摘要：
- 分析期間: ${periodSummary}
- 總收聽時長: ${formatMsToMinSec(totalMsPlayed)} (${totalMsPlayed} 毫秒)
- 最高收聽日: ${biggestListeningDay} (播放時長: ${formatMsToMinSec(maxDailyMs)} / ${maxDailyMs} 毫秒)
- 熱門歌曲 (前5名，歌曲名稱 - 歌手，播放次數)：
${sortedSongs.map(s => `- ${s.song} - ${s.artist} (${s.count} 次)`).join('\n')}
- 熱門歌手 (前5名，歌手名稱，播放次數)：
${sortedArtists.map(a => `- ${a.name} (${a.count} 次)`).join('\n')}

請根據這些數據生成以下 JSON 結構：
{
  "recapTitle": "${periodSummary} 音樂回顧",
  "totalMinutesListenedCard": {
    "title": "我的總收聽時長",
    "value": "${totalMinutesCardValue}",
    "unit": "${totalMinutesCardUnit}",
    "subText": "${totalMinutesCardSubText}",
    "biggestListeningDay": {
      "date": "${biggestListeningDayDate}",
      "minutes": "${biggestListeningDayMinutes}"
    }
  },
  "topSongsCard": {
    "title": "我的熱門歌曲",
    "songs": [
      ${sortedSongs.map(s => `{ "rank": ${s.rank}, "song": "${s.song.replace(/"/g, '\\"')}", "artist": "${s.artist.replace(/"/g, '\\"')}" }`).join(',\n      ')}
    ]
  },
  "topArtistsCard": {
    "title": "我的熱門歌手",
    "artists": [
      ${sortedArtists.map(a => `{ "rank": ${a.rank}, "artist": "${a.name.replace(/"/g, '\\"')}" }`).join(',\n      ')}
    ]
  },
  "musicEvolutionCard": {
    "title": "我的音樂進化",
    "description": "[Gemini AI 根據熱門歌曲/歌手和播放趨勢，總結用戶音樂品味的演變。內容應具洞察力，約50-80字。]"
  },
  "wordsToDescribeCard": {
    "title": "描述我的音樂風格",
    "words": [
      "[詞彙1]",
      "[詞彙2]",
      "[詞彙3]",
      "[詞彙4]",
      "[詞彙5]"
    ],
    "description": "[簡要解釋這些詞彙如何描述用戶的音樂風格，約20-30字。]"
  }
}
請根據提供的數據填充上述 JSON 結構。特別注意：
- totalMinutesListenedCard.value 請使用格式化後的分鐘數 (XX,XXX) 或 'N/A'。
- biggestListeningDay 的日期請使用YYYYMMDD 格式或 'N/A'。
- songs 和 artists 列表請確保包含5項，如果數據不足則填寫 '未知'。
- 確保所有文字都是繁體中文。
- wordsToDescribeCard.words 應是 5 個描述性的詞彙。
- 為了避免 JSON 格式錯誤，歌曲標題和藝術家名稱中的雙引號請進行轉義 (e.g., \")。
`;
        const schema = {
            type: "OBJECT",
            properties: {
                recapTitle: { type: "STRING" },
                totalMinutesListenedCard: {
                    type: "OBJECT",
                    properties: {
                        title: { type: "STRING" },
                        value: { type: "STRING" },
                        unit: { type: "STRING" },
                        subText: { type: "STRING" },
                        biggestListeningDay: {
                            type: "OBJECT",
                            properties: {
                                date: { type: "STRING" },
                                minutes: { type: "STRING" }
                            },
                            propertyOrdering: ["date", "minutes"]
                        }
                    },
                    propertyOrdering: ["title", "value", "unit", "subText", "biggestListeningDay"]
                },
                topSongsCard: {
                    type: "OBJECT",
                    properties: {
                        title: { type: "STRING" },
                        songs: {
                            type: "ARRAY",
                            items: {
                                type: "OBJECT",
                                properties: {
                                    rank: { type: "NUMBER" },
                                    song: { type: "STRING" },
                                    artist: { type: "STRING" }
                                },
                                propertyOrdering: ["rank", "song", "artist"]
                            }
                        }
                    },
                    propertyOrdering: ["title", "songs"]
                },
                topArtistsCard: {
                    type: "OBJECT",
                    properties: {
                        title: { type: "STRING" },
                        artists: {
                            "type": "ARRAY",
                            "items": {
                                "type": "OBJECT",
                                "properties": {
                                    "rank": { "type": "NUMBER" },
                                    "artist": { "type": "STRING" }
                                },
                                "propertyOrdering": ["rank", "artist"]
                            }
                        }
                    },
                    propertyOrdering: ["title", "artists"]
                },
                musicEvolutionCard: {
                    type: "OBJECT",
                    properties: {
                        title: { type: "STRING" },
                        description: { type: "STRING" }
                    },
                    propertyOrdering: ["title", "description"]
                },
                wordsToDescribeCard: {
                    type: "OBJECT",
                    properties: {
                        title: { type: "STRING" },
                        words: {
                            type: "ARRAY",
                            items: { type: "STRING" }
                        },
                        description: { type: "STRING" }
                    },
                    propertyOrdering: ["title", "words", "description"]
                }
            },
            propertyOrdering: [
                "recapTitle",
                "totalMinutesListenedCard",
                "topSongsCard",
                "topArtistsCard",
                "musicEvolutionCard",
                "wordsToDescribeCard"
            ]
        };

        await callGeminiAPI(prompt, "您的音樂回顧 (Recap)", true, schema, 'recap');
        setIsRecapLoading(false); // Set loading to false after API call
    }, [allStreamingDataOriginal, callGeminiAPI, recapApplyAllData]);


    // Detail Modal Component
    const DetailModal = ({ isOpen, onClose, records, title, maxPlayTimes, searchTerm, onSearchChange, onSearch, onClearSearch, onExport, searchLyricsOnline, searchAlbumReviewOnline, searchArtistBioOnline, onSongInsight, youtubeVideoId, youtubeLoading }) => {
        // Ensure useMemo is always called when DetailModal is rendered
        const filteredRecords = useMemo(() => {
            // Only perform filtering if the modal is logically open and a search term exists
            if (!isOpen || !searchTerm) return records;

            const searchTermLower = searchTerm.toLowerCase();
            return records.filter(record => {
                const fieldsToSearch = [
                    record.ts || '',
                    record.platform || '',
                    record.master_metadata_track_name || '',
                    record.master_metadata_album_artist_name || '',
                    record.master_metadata_album_album_name || '',
                    formatMsToMinSec(getMsFromRecord(record.ms_played || 0)),
                    record.reason_start || '',
                    record.reason_end || ''
                ];
                for (const boolField of ["shuffle", "skipped", "offline", "incognito_mode"]) {
                    const rawVal = record[boolField];
                    if (rawVal === true) fieldsToSearch.push("是");
                    else if (rawVal === false) fieldsToSearch.push("否");
                    else fieldsToSearch.push("N/A");
                }
                return fieldsToSearch.some(field => String(field).toLowerCase().includes(searchTermLower));
            });
        }, [isOpen, records, searchTerm]); // Add isOpen to dependencies

        // No conditional return at the top level of the component for rendering JSX
        const firstRecord = records[0] || {};
        const item_name_for_web_search = firstRecord.master_metadata_track_name || '';
        const artist_name_for_web_search = firstRecord.master_metadata_album_artist_name || '';
        const album_name_for_web_search = firstRecord.master_metadata_album_album_name || '';

        return (
            <div ref={detailModalRef} className={`fixed inset-0 bg-black bg-opacity-70 flex justify-center items-center p-4 z-50 transition-opacity duration-300 ${isOpen ? 'opacity-100 visible' : 'opacity-0 invisible'}`}>
                {isOpen && ( // Conditionally render inner content only if modal is open
                    <div className="bg-gradient-to-br from-purple-800 to-indigo-900 text-white rounded-xl sm:rounded-3xl shadow-2xl p-4 sm:p-8 w-full max-w-full sm:max-w-3xl md:max-w-4xl lg:max-w-6xl max-h-[95vh] flex flex-col transform scale-95 opacity-0 animate-fade-in-up">
                        <style>{`
                            @keyframes fade-in-up {
                                from { opacity: 0; transform: translateY(20px) scale(0.95); }
                                to { opacity: 1; transform: translateY(0) scale(1); }
                            }
                            .animate-fade-in-up {
                                animation: fade-in-up 0.3s ease-out forwards;
                            }
                        `}</style>
                        <h2 className="text-xl sm:text-3xl font-bold mb-4 sm:mb-6 text-center drop-shadow-md">{title}</h2>

                        <div className="flex flex-col sm:flex-row items-center space-y-2 sm:space-y-0 sm:space-x-2 mb-4 sm:mb-6 bg-gray-800 p-3 sm:p-4 rounded-lg sm:rounded-xl shadow-inner">
                            <label htmlFor="detailSearch" className="text-gray-200 text-base sm:text-lg font-medium">搜尋詳細記錄:</label>
                            <input
                                id="detailSearch"
                                type="text"
                                className="flex-grow p-2 sm:p-3 border border-gray-600 rounded-lg bg-gray-700 text-white placeholder-gray-400 focus:ring-blue-500 focus:border-blue-500 focus:ring-2 transition duration-200 text-sm sm:text-base"
                                value={searchTerm}
                                onChange={(e) => onSearchChange(e.target.value)}
                                placeholder="搜尋..."
                            />
                            <button
                                onClick={onSearch}
                                className="px-4 py-2 sm:px-6 sm:py-3 bg-gradient-to-r from-blue-500 to-blue-700 text-white rounded-lg sm:rounded-xl shadow-lg hover:from-blue-600 hover:to-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-800 transition transform hover:scale-105 active:scale-95 text-sm sm:text-base"
                            >
                                搜尋
                            </button>
                            <button
                                onClick={onClearSearch}
                                className="px-4 py-2 sm:px-6 sm:py-3 bg-gradient-to-r from-gray-400 to-gray-600 text-gray-900 rounded-lg sm:rounded-xl shadow-lg hover:from-gray-500 hover:to-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 focus:ring-offset-gray-800 transition transform hover:scale-105 active:scale-95 text-sm sm:text-base"
                            >
                                清除
                            </button>
                            <button
                                onClick={onExport}
                                className="px-4 py-2 sm:px-6 sm:py-3 bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-lg sm:rounded-xl shadow-lg hover:from-green-600 hover:to-emerald-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 focus:ring-offset-gray-800 transition transform hover:scale-105 active:scale-95 ml-auto text-sm sm:text-base"
                            >
                                匯出 CSV
                            </button>
                        </div>

                        <div className="flex flex-wrap gap-2 sm:gap-3 mb-4 sm:mb-6 justify-center">
                            {item_name_for_web_search && artist_name_for_web_search && (
                                <button
                                    onClick={() => searchLyricsOnline(item_name_for_web_search, artist_name_for_web_search)}
                                    className="px-3 py-2 sm:px-4 sm:py-2 bg-gradient-to-r from-purple-500 to-pink-600 text-white text-xs sm:text-md rounded-lg shadow-md hover:from-purple-600 hover:to-pink-700 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 focus:ring-offset-gray-800 transition transform hover:scale-105 active:scale-95"
                                >
                                    Google 搜尋歌詞
                                </button>
                            )}
                            {album_name_for_web_search && artist_name_for_web_search && (
                                <button
                                    onClick={() => searchAlbumReviewOnline(album_name_for_web_search, artist_name_for_web_search)}
                                    className="px-3 py-2 sm:px-4 sm:py-2 bg-gradient-to-r from-orange-500 to-red-600 text-white text-xs sm:text-md rounded-lg shadow-md hover:from-orange-600 hover:to-red-700 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 focus:ring-offset-gray-800 transition transform hover:scale-105 active:scale-95"
                                >
                                    Google 搜尋專輯評價
                                </button>
                            )}
                            {artist_name_for_web_search && ( 
                                <button
                                    onClick={() => searchArtistBioOnline(artist_name_for_web_search)}
                                    className="px-3 py-2 sm:px-4 sm:py-2 bg-gradient-to-r from-teal-500 to-cyan-600 text-white text-xs sm:text-md rounded-lg shadow-md hover:from-teal-600 hover:to-cyan-700 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2 focus:ring-offset-gray-800 transition transform hover:scale-105 active:scale-95"
                                >
                                    Google 搜尋藝術家簡介
                                </button>
                            )}
                            {item_name_for_web_search && artist_name_for_web_search && (
                                <button
                                    onClick={() => onSongInsight(item_name_for_web_search, artist_name_for_web_search)}
                                    className="px-3 py-2 sm:px-4 sm:py-2 bg-gradient-to-r from-blue-500 to-purple-600 text-white text-xs sm:text-md rounded-lg shadow-md hover:from-blue-600 hover:to-purple-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-800 transition transform hover:scale-105 active:scale-95"
                                >
                                    ✨ 歌曲洞察
                                </button>
                            )}
                        </div>

                        {/* YouTube MV and Details Table - Side-by-side on larger screens */}
                        {/* Ensure this flex-grow container has min-h-0 and no overflow-hidden here */}
                        <div className="flex flex-col md:flex-row flex-grow gap-4 sm:gap-6 mb-4 min-h-0">
                            {/* YouTube MV Section */}
                            <div className="w-full md:w-1/2 flex flex-col">
                                {youtubeLoading ? (
                                    <div className="flex justify-center items-center h-48 my-4 bg-gray-800 rounded-lg">
                                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
                                        <span className="ml-3 text-lg text-gray-300">載入 MV 中...</span>
                                    </div>
                                ) : youtubeVideoId ? (
                                    <div className="flex flex-col items-center my-4">
                                        <h3 className="text-xl font-semibold mb-3 text-gray-200">YouTube MV</h3>
                                        {/* Removed overflow-hidden from this parent div and ensured iframe fills its container */}
                                        <div className="relative w-full rounded-xl" style={{ paddingTop: '56.25%' /* 16:9 Aspect Ratio */ }}>
                                            <iframe
                                                className="absolute top-0 left-0 w-full h-full"
                                                src={`https://www.youtube.com/embed/${youtubeVideoId}`}
                                                title="YouTube video player"
                                                frameBorder="0"
                                                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                                                allowFullScreen
                                            ></iframe>
                                        </div>
                                    </div>
                                ) : (
                                    item_name_for_web_search && artist_name_for_web_search && !youtubeLoading && (
                                        <div className="text-center my-4 p-3 bg-gray-800 rounded-lg text-gray-400 text-sm">
                                            此歌曲無 MV 或搜尋失敗。
                                        </div>
                                    )
                                )}
                            </div>

                            {/* Detailed Records Table Section */}
                            {/* This div should still be flex-grow and overflow-auto */}
                            <div className="w-full md:w-1/2 flex-grow overflow-auto border border-gray-600 rounded-xl shadow-inner text-xs sm:text-sm">
                                <h3 className="text-xl font-semibold mb-3 text-gray-200 p-2 sticky top-0 bg-gray-800 z-10 rounded-t-xl">詳細記錄</h3>
                                <table className="min-w-full divide-y divide-gray-700">
                                    <thead className="bg-gray-800 sticky top-0">
                                        <tr>
                                            {["播放時間 (UTC)", "播放平台", "播放時長 (分:秒)", "歌曲名稱", "歌手", "專輯名稱",
                                                "播放完整度(%)", "開始原因", "結束原因", "隨機播放", "是否跳過", "離線播放", "隱身模式"].map(header => (
                                                    <th key={header} className="px-2 py-2 sm:px-4 sm:py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                                                        {header}
                                                    </th>
                                                ))}
                                        </tr>
                                    </thead>
                                    <tbody className="bg-gray-900 divide-y divide-gray-700">
                                        {filteredRecords.map((record, index) => {
                                            const ms_played_int = getMsFromRecord(record.ms_played || 0);
                                            const uri = record.spotify_track_uri;
                                            let play_completion_percentage = "N/A";
                                            if (maxPlayTimes && uri && maxPlayTimes[uri] > 0) {
                                                const percentage = (ms_played_int / maxPlayTimes[uri]) * 100;
                                                play_completion_percentage = `${percentage.toFixed(1)}%`;
                                            }

                                            return (
                                                <tr key={index} className="hover:bg-gray-700 transition-colors duration-150 ease-in-out">
                                                    <td className="px-2 py-1 sm:px-4 sm:py-2 whitespace-nowrap text-xs sm:text-sm text-gray-200">{record.ts || 'N/A'}</td>
                                                    <td className="px-2 py-1 sm:px-4 sm:py-2 whitespace-nowrap text-xs sm:text-sm text-gray-200">{record.platform || 'N/A'}</td>
                                                    <td className="px-2 py-1 sm:px-4 sm:py-2 whitespace-nowrap text-xs sm:text-sm text-gray-200 text-right">{formatMsToMinSec(ms_played_int)}</td>
                                                    <td className="px-2 py-1 sm:px-4 sm:py-2 whitespace-nowrap text-xs sm:text-sm text-gray-200">{record.master_metadata_track_name || 'N/A'}</td>
                                                    <td className="px-2 py-1 sm:px-4 sm:py-2 whitespace-nowrap text-xs sm:text-sm text-gray-200">{record.master_metadata_album_artist_name || 'N/A'}</td>
                                                    <td className="px-2 py-1 sm:px-4 sm:py-2 whitespace-nowrap text-xs sm:text-sm text-gray-200">{record.master_metadata_album_album_name || 'N/A'}</td>
                                                    <td className="px-2 py-1 sm:px-4 sm:py-2 whitespace-nowrap text-xs sm:text-sm text-gray-200 text-center">{play_completion_percentage}</td>
                                                    <td className="px-2 py-1 sm:px-4 sm:py-2 whitespace-nowrap text-xs sm:text-sm text-gray-200">{record.reason_start || 'N/A'}</td>
                                                    <td className="px-2 py-1 sm:px-4 sm:py-2 whitespace-nowrap text-xs sm:text-sm text-gray-200">{record.reason_end || 'N/A'}</td>
                                                    <td className="px-2 py-1 sm:px-4 sm:py-2 whitespace-nowrap text-xs sm:text-sm text-gray-200">{record.shuffle === true ? "是" : (record.shuffle === false ? "否" : "N/A")}</td>
                                                    <td className="px-2 py-1 sm:px-4 sm:py-2 whitespace-nowrap text-xs sm:text-sm text-gray-200">{record.skipped === true ? "是" : (record.skipped === false ? "否" : "N/A")}</td>
                                                    <td className="px-2 py-1 sm:px-4 sm:py-2 whitespace-nowrap text-xs sm:text-sm text-gray-200">{record.offline === true ? "是" : (record.offline === false ? "否" : "N/A")}</td>
                                                    <td className="px-2 py-1 sm:px-4 sm:py-2 whitespace-nowrap text-xs sm:text-sm text-gray-200">{record.incognito_mode === true ? "是" : (record.incognito_mode === false ? "否" : "N/A")}</td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        <div className="flex justify-end mt-4 sm:mt-6">
                            <button
                                onClick={onClose}
                                className="px-6 py-2 sm:px-8 sm:py-3 bg-gradient-to-r from-red-600 to-rose-700 text-white font-semibold rounded-xl shadow-lg hover:from-red-700 hover:to-rose-800 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 focus:ring-offset-gray-800 transition transform hover:scale-105 active:scale-95 text-sm sm:text-base"
                            >
                                關閉
                            </button>
                        </div>
                    </div>
                )}
            </div>
        );
    };

    // Artist Modal Component
    const ArtistModal = ({ isOpen, onClose, artistName, albumsData, songsData, onAlbumSelect, onSongDoubleClick, onArtistBioSearch, onArtistInsight, isLoading }) => {
        if (!isOpen) return null;

        return (
            <div ref={artistModalRef} className={`fixed inset-0 bg-black bg-opacity-70 flex justify-center items-center p-4 z-50 transition-opacity duration-300 ${isOpen ? 'opacity-100 visible' : 'opacity-0 invisible'}`}>
                <div className="bg-gradient-to-br from-green-800 to-emerald-900 text-white rounded-xl sm:rounded-3xl shadow-2xl p-4 sm:p-8 w-full max-w-full sm:max-w-4xl md:max-w-5xl lg:max-w-6xl max-h-[95vh] flex flex-col transform scale-95 opacity-0 animate-fade-in-up">
                    <h2 className="text-xl sm:text-3xl font-bold mb-4 sm:mb-6 text-center drop-shadow-md">歌手詳細資料: {artistName}</h2>

                    <div className="flex flex-wrap justify-center mb-4 sm:mb-6 gap-2 sm:gap-3">
                        <button
                            onClick={() => onArtistBioSearch(artistName)}
                            className="px-4 py-2 sm:px-6 sm:py-3 bg-gradient-to-r from-purple-500 to-indigo-600 text-white rounded-lg sm:rounded-xl shadow-lg hover:from-purple-600 hover:to-indigo-700 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 focus:ring-offset-gray-800 transition transform hover:scale-105 active:scale-95 text-sm sm:text-base"
                        >
                            Google 搜尋藝術家簡介
                        </button>
                        <button
                            onClick={() => onArtistInsight(artistName)}
                            className="px-4 py-2 sm:px-6 sm:py-3 bg-gradient-to-r from-blue-500 to-purple-600 text-white rounded-lg sm:rounded-xl shadow-lg hover:from-blue-600 hover:to-purple-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-800 transition transform hover:scale-105 active:scale-95 text-sm sm:text-base"
                        >
                            ✨ 歌手洞察
                        </button>
                    </div>

                    {isLoading ? (
                        <div className="flex flex-grow justify-center items-center h-full">
                            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white"></div>
                            <span className="ml-3 text-xl">載入歌手資料中...</span>
                        </div>
                    ) : (
                        <div className="flex flex-col md:flex-row flex-grow overflow-hidden gap-4 sm:gap-6">
                            {/* Left Pane: Albums */}
                            <div className="w-full md:w-1/3 flex flex-col border border-gray-600 rounded-xl p-3 sm:p-4 overflow-auto bg-gray-800 shadow-inner">
                                <h3 className="text-lg sm:text-xl font-semibold mb-3 sm:mb-4 sticky top-0 bg-gray-800 z-10 p-2 -mx-3 -mt-3 sm:-mx-4 sm:-mt-4 border-b border-gray-700">專輯列表</h3>
                                <table className="min-w-full divide-y divide-gray-700 text-xs sm:text-sm">
                                    <thead className="bg-gray-900 sticky top-0">
                                        <tr>
                                            <th className="px-2 py-2 sm:px-4 sm:py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">專輯名稱</th>
                                            <th className="px-2 py-2 sm:px-4 sm:py-3 text-right text-xs font-medium text-gray-300 uppercase tracking-wider">播放次數</th>
                                            <th className="px-2 py-2 sm:px-4 sm:py-3 text-right text-xs font-medium text-gray-300 uppercase tracking-wider">總時長</th>
                                        </tr>
                                    </thead>
                                    <tbody className="bg-gray-800 divide-y divide-gray-700">
                                        {albumsData.map((album, index) => (
                                            <tr key={index} className="hover:bg-gray-700 cursor-pointer transition-colors duration-150 ease-in-out" onClick={() => onAlbumSelect(album.albumName)}>
                                                <td className="px-2 py-1 sm:px-4 sm:py-2 whitespace-nowrap text-xs sm:text-sm text-gray-200">{album.albumName}</td>
                                                <td className="px-2 py-1 sm:px-4 sm:py-2 whitespace-nowrap text-xs sm:text-sm text-gray-200 text-right">{album.count}</td>
                                                <td className="px-2 py-1 sm:px-4 sm:py-2 whitespace-nowrap text-xs sm:text-sm text-gray-200 text-right">{album.totalDuration}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            {/* Right Pane: Songs */}
                            <div className="w-full md:w-2/3 flex flex-col border border-gray-600 rounded-xl p-3 sm:p-4 overflow-auto bg-gray-800 shadow-inner">
                                <h3 className="text-lg sm:text-xl font-semibold mb-3 sm:mb-4 sticky top-0 bg-gray-800 z-10 p-2 -mx-3 -mt-3 sm:-mx-4 sm:-mt-4 border-b border-gray-700">歌曲列表</h3>
                                <table className="min-w-full divide-y divide-gray-700 text-xs sm:text-sm">
                                    <thead className="bg-gray-900 sticky top-0">
                                        <tr>
                                            <th className="px-2 py-2 sm:px-4 sm:py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">歌曲名稱</th>
                                            <th className="px-2 py-2 sm:px-4 sm:py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">所屬專輯</th>
                                            <th className="px-2 py-2 sm:px-4 sm:py-3 text-right text-xs font-medium text-gray-300 uppercase tracking-wider">播放次數</th>
                                            <th className="px-2 py-2 sm:px-4 sm:py-3 text-right text-xs font-medium text-gray-300 uppercase tracking-wider">總時長</th>
                                        </tr>
                                    </thead>
                                    <tbody className="bg-gray-800 divide-y divide-gray-700">
                                        {songsData.map((song, index) => (
                                            <tr key={index} className="hover:bg-gray-700 cursor-pointer transition-colors duration-150 ease-in-out" onDoubleClick={() => onSongDoubleClick(song.songName, song.albumName)}>
                                                <td className="px-2 py-1 sm:px-4 sm:py-2 whitespace-nowrap text-xs sm:text-sm text-gray-200">{song.songName}</td>
                                                <td className="px-2 py-1 sm:px-4 sm:py-2 whitespace-nowrap text-xs sm:text-sm text-gray-200">{song.albumName}</td>
                                                <td className="px-2 py-1 sm:px-4 sm:py-2 whitespace-nowrap text-xs sm:text-sm text-gray-200 text-right">{song.count}</td>
                                                <td className="px-2 py-1 sm:px-4 sm:py-2 whitespace-nowrap text-xs sm:text-sm text-gray-200 text-right">{song.totalDuration}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    <div className="flex justify-end mt-4 sm:mt-6">
                        <button
                            onClick={onClose}
                            className="px-6 py-2 sm:px-8 sm:py-3 bg-gradient-to-r from-red-600 to-rose-700 text-white font-semibold rounded-xl shadow-lg hover:from-red-700 hover:to-rose-800 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 focus:ring-offset-gray-800 transition transform hover:scale-105 active:scale-95 text-sm sm:text-base"
                        >
                            關閉
                        </button>
                    </div>
                </div>
            </div>
        );
    };

    const GeminiResponseModal = ({ isOpen, onClose, title, content, isLoading }) => {
        if (!isOpen) return null;

        return (
            <div className="fixed inset-0 bg-black bg-opacity-70 flex justify-center items-center p-4 z-50">
                <div className="bg-gradient-to-br from-gray-700 to-gray-900 text-white rounded-xl sm:rounded-3xl shadow-2xl p-4 sm:p-8 w-full max-w-full sm:max-w-md md:max-w-lg lg:max-w-xl max-h-[90vh] flex flex-col">
                    <h2 className="text-xl sm:text-2xl font-bold mb-4 text-center">{title}</h2>
                    <div className="flex-grow overflow-auto mb-4 sm:mb-6 p-3 sm:p-4 bg-gray-800 rounded-lg border border-gray-600 text-sm sm:text-base">
                        {isLoading ? (
                            <div className="flex justify-center items-center h-full">
                                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
                                <span className="ml-3 text-lg">載入中...</span>
                            </div>
                        ) : (
                            <p className="text-gray-100 whitespace-pre-wrap">{content}</p>
                        )}
                    </div>
                    <div className="flex justify-end">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 sm:px-6 sm:py-2 bg-gradient-to-r from-red-500 to-rose-600 text-white rounded-xl shadow-lg hover:from-red-600 hover:to-rose-700 transition transform hover:scale-105 active:scale-95 text-sm sm:text-base"
                        >
                            關閉
                        </button>
                    </div>
                </div>
            </div>
        );
    };

    const RecommendationChoiceModal = ({ isOpen, onClose, onSelect }) => {
        if (!isOpen) return null;

        return (
            <div className="fixed inset-0 bg-black bg-opacity-70 flex justify-center items-center p-4 z-50">
                <div className="bg-gradient-to-br from-blue-800 to-purple-900 text-white rounded-xl sm:rounded-3xl shadow-2xl p-4 sm:p-8 w-full max-w-full sm:max-w-md flex flex-col items-center">
                    <h2 className="text-xl sm:text-2xl font-bold mb-4 sm:mb-6 text-center">推薦歌單選項</h2>
                    <p className="text-base sm:text-lg text-center mb-6 sm:mb-8">您希望如何獲取推薦歌單？</p>
                    <div className="flex flex-col space-y-3 sm:space-y-4 w-full">
                        <button
                            onClick={() => onSelect('random')}
                            className="px-6 py-3 sm:px-8 sm:py-4 bg-gradient-to-r from-teal-500 to-cyan-600 text-white font-semibold rounded-xl shadow-lg hover:from-teal-600 hover:to-cyan-700 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2 transition transform hover:scale-105 active:scale-95 text-base sm:text-lg"
                        >
                            隨機推薦
                        </button>
                        <button
                            onClick={() => onSelect('unheard')}
                            className="px-6 py-3 sm:px-8 sm:py-4 bg-gradient-to-r from-orange-500 to-red-600 text-white font-semibold rounded-xl shadow-lg hover:from-orange-600 hover:to-red-700 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 transition transform hover:scale-105 active:scale-95 text-base sm:text-lg"
                        >
                            隨機但沒有聽過的歌
                        </button>
                    </div>
                    <button
                        onClick={onClose}
                        className="mt-6 sm:mt-8 px-4 py-2 sm:px-6 sm:py-3 bg-gradient-to-r from-gray-500 to-gray-700 text-white rounded-xl shadow-lg hover:from-gray-600 hover:to-gray-800 transition transform hover:scale-105 active:scale-95 text-sm sm:text-base"
                    >
                        取消
                    </button>
                </div>
            </div>
        );
    };

    // Corrected RecapDateSelectModal: State for dates is now local to this component.
    const RecapDateSelectModal = ({ isOpen, onClose, onConfirm, onApplyAllDataChange, applyAllData }) => {
        // Local state for the input fields
        const [localStartDate, setLocalStartDate] = useState("");
        const [localEndDate, setLocalEndDate] = useState("");
    
        // Effect to reset local dates when modal opens/closes, or applyAllData changes
        useEffect(() => {
            if (!isOpen) { // Reset when closing
                setLocalStartDate("");
                setLocalEndDate("");
            }
        }, [isOpen]);
    
        // When 'Apply all data' is toggled, clear local dates
        useEffect(() => {
            if (applyAllData) {
                setLocalStartDate("");
                setLocalEndDate("");
            }
        }, [applyAllData]);
    
        if (!isOpen) return null; // Only render if isOpen is true
    
        return (
            <div className="fixed inset-0 bg-black bg-opacity-70 flex justify-center items-center p-4 z-50 transition-opacity duration-300 opacity-100 visible">
                <div className="bg-gradient-to-br from-indigo-800 to-blue-900 text-white rounded-xl sm:rounded-3xl shadow-2xl p-4 sm:p-8 w-full max-w-full sm:max-w-md flex flex-col items-center transform scale-100 opacity-100">
                    <h2 className="text-xl sm:text-2xl font-bold mb-4 sm:mb-6 text-center">選擇回顧日期範圍</h2>
                    <p className="text-base sm:text-lg text-center mb-6 sm:mb-8">請選擇您希望回顧的日期區間，或選擇分析所有資料。</p>
                    
                    <div className="w-full space-y-4 mb-6">
                        <div className="flex items-center space-x-2">
                            <label htmlFor="recapStartDate" className="text-gray-200 text-sm sm:text-base">開始日期 (YYYYMMDD):</label>
                            <input
                                id="recapStartDate"
                                type="text"
                                className={`flex-grow p-2 sm:p-3 border rounded-lg text-sm sm:text-base ${applyAllData ? 'bg-gray-700 border-gray-600 cursor-not-allowed' : 'bg-gray-100 border-gray-300'} text-gray-900 placeholder-gray-400 focus:ring-blue-500 focus:border-blue-500 transition duration-200 shadow-sm`}
                                value={localStartDate}
                                onChange={(e) => setLocalStartDate(e.target.value)}
                                disabled={applyAllData}
                                placeholder="20230101"
                            />
                        </div>
                        <div className="flex items-center space-x-2">
                            <label htmlFor="recapEndDate" className="text-gray-200 text-sm sm:text-base">結束日期 (YYYYMMDD):</label>
                            <input
                                id="recapEndDate"
                                type="text"
                                className={`flex-grow p-2 sm:p-3 border rounded-lg text-sm sm:text-base ${applyAllData ? 'bg-gray-700 border-gray-600 cursor-not-allowed' : 'bg-gray-100 border-gray-300'} text-gray-900 placeholder-gray-400 focus:ring-blue-500 focus:border-blue-500 transition duration-200 shadow-sm`}
                                value={localEndDate}
                                onChange={(e) => setLocalEndDate(e.target.value)}
                                disabled={applyAllData}
                                placeholder="20231231"
                            />
                        </div>
                        <div className="flex items-center mt-4">
                            <input
                                type="checkbox"
                                id="applyAllData"
                                checked={applyAllData}
                                onChange={(e) => onApplyAllDataChange(e.target.checked)}
                                className="form-checkbox h-5 w-5 text-purple-600 rounded focus:ring-purple-500"
                            />
                            <label htmlFor="applyAllData" className="ml-2 text-gray-200 text-base sm:text-lg">套用全部資料 (將不顯示總收聽時長)</label>
                        </div>
                    </div>
    
                    <div className="flex space-x-4">
                        <button
                            onClick={() => onConfirm(localStartDate, localEndDate)} // Pass local state back
                            className="px-6 py-3 sm:px-8 sm:py-4 bg-gradient-to-r from-green-500 to-emerald-600 text-white font-semibold rounded-xl shadow-lg hover:from-green-600 hover:to-emerald-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 transition transform hover:scale-105 active:scale-95 text-base sm:text-lg"
                        >
                            確認
                        </button>
                        <button
                            onClick={onClose}
                            className="px-6 py-3 sm:px-8 sm:py-4 bg-gradient-to-r from-gray-500 to-gray-700 text-white rounded-xl shadow-lg hover:from-gray-600 hover:to-gray-800 transition transform hover:scale-105 active:scale-95 text-base sm:text-lg"
                        >
                            取消
                        </button>
                    </div>
                </div>
            </div>
        );
    };

    // New HowToUse component (placed inside App for self-contained immersive)
    const HowToUse = ({ onBack }) => {
        return (
            <div className="bg-white p-4 sm:p-8 rounded-2xl sm:rounded-3xl shadow-xl w-full mx-auto max-w-full sm:max-w-3xl md:max-w-5xl lg:max-w-7xl">
                <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold text-center text-gray-900 mb-4 sm:mb-8 tracking-wide">如何使用 Spotify 播放記錄分析器</h1>

                <div className="prose max-w-none text-gray-800 space-y-4 sm:space-y-6 text-sm sm:text-base">
                    <h2 className="text-xl sm:text-3xl font-semibold text-gray-700 mb-2 sm:mb-4 border-b-2 border-gray-200 pb-1 sm:pb-2">1. 取得您的 Spotify 播放記錄</h2>
                    <p>要使用本工具，您需要從 Spotify 獲取您的「延伸串流歷史記錄」資料。請按照以下步驟操作：</p>
                    <ol className="list-decimal list-inside pl-4 space-y-1 sm:space-y-2">
                        <li>登入您的 Spotify 帳戶。</li>
                        <li>前往 <a href="https://www.spotify.com/tw/account/privacy/" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline font-medium">Spotify 隱私設定頁面</a>。</li>
                        <li>捲動到「下載您的資料」部分。</li>
                        <li>選擇「延伸串流歷史記錄」選項，然後點擊「要求資料」或「提交申請」。</li>
                        <li>Spotify 可能需要數天或數週才能準備好您的資料。準備好後，您會收到一封包含下載連結的電子郵件。下載後，您將會得到一個或多個名為 `StreamingHistoryX.json` 的檔案（其中 X 是數字，例如 `StreamingHistory0.json`, `StreamingHistory1.json`）。</li>
                    </ol>

                    <h2 className="text-xl sm:text-3xl font-semibold text-gray-700 mb-2 sm:mb-4 border-b-2 border-gray-200 pb-1 sm:pb-2 mt-6 sm:mt-8">2. 上傳您的 JSON 檔案</h2>
                    <ol className="list-decimal list-inside pl-4 space-y-1 sm:space-y-2">
                        <li>在主分析器頁面，點擊「選擇 JSON 檔案」按鈕。</li>
                        <li>選取您從 Spotify 下載的所有 `StreamingHistoryX.json` 檔案。您可以一次選取多個檔案。</li>
                        <li>應用程式會自動載入並合併這些資料，並顯示載入進度。</li>
                    </ol>

                    <h2 className="text-xl sm:text-3xl font-semibold text-gray-700 mb-2 sm:mb-4 border-b-2 border-gray-200 pb-1 sm:pb-2 mt-6 sm:mt-8">3. 設定篩選與排行條件</h2>
                    <p>載入資料後，您可以根據自己的需求設定分析條件：</p>
                    <ul className="list-disc list-inside pl-4 space-y-1 sm:space-y-2">
                        <li>**依日期篩選？**：勾選此項以啟用日期範圍篩選。在「開始日期」和「結束日期」欄位中輸入日期（格式為YYYYMMDD，例如 `20230101`）。</li>
                        <li>**排行項目**：從下拉選單中選擇您希望排行的項目，例如「歌曲名稱 - 歌手」、「歌手」、「專輯 - 歌手」、「播放平台」等。</li>
                        <li>**顯示數量**：輸入數字以顯示前 N 個結果（例如 `10`），或輸入「all」以顯示所有結果。</li>
                        <li>**排行標準**：選擇排行的依據，包括「播放次數」（預設）、「總播放時長」或「平均播放時長」。</li>
                        <li>**趨勢分析**：您可以從下拉選單中選擇「每月總收聽時間」、「每月熱門歌曲」或「每月熱門歌手」來查看數據的趨勢。此選項會禁用常規排行設定。</li>
                        <li>**搜尋結果**：在主介面的「搜尋結果」欄位中輸入關鍵字，可以在當前顯示的排行結果中進行即時搜尋。</li>
                    </ul>

                    <h2 className="text-xl sm:text-3xl font-semibold text-gray-700 mb-2 sm:mb-4 border-b-2 border-gray-200 pb-1 sm:pb-2 mt-6 sm:mt-8">4. 開始分析與查看結果</h2>
                    <ol className="list-decimal list-inside pl-4 space-y-1 sm:space-y-2">
                        <li>設定好條件後，點擊「開始分析」按鈕。</li>
                        <li>結果將以表格形式顯示在頁面下方。</li>
                        <li>**查看詳細資料**：您可以**單擊**表格中的「單曲」、「歌曲名稱 - 歌手」、「專輯」或「歌手」項目，以彈出一個視窗查看其詳細的播放記錄。此時，如果該歌曲有 MV，將會在視窗中自動播放。本應用程式已內建 YouTube Data API v3 金鑰，無需手動輸入。</li>
                        <li>**匯出數據**：您可以點擊「匯出 CSV」按鈕將當前主分析結果或詳細記錄視窗中的數據匯出為 CSV 檔案。</li>
                        <li>**重設應用程式**：點擊「重設」按鈕將清除所有載入的數據和篩選條件，將應用程式恢復到初始狀態。</li>
                    </ol>

                    <h2 className="text-xl sm:text-3xl font-semibold text-gray-700 mb-2 sm:mb-4 border-b-2 border-gray-200 pb-1 sm:pb-2 mt-6 sm:mt-8">5. Gemini AI 智慧分析與推薦</h2>
                    <p>本工具整合了 Gemini AI 功能，為您提供更深入的音樂洞察和智慧推薦：</p>
                    <ul className="list-disc list-inside pl-4 space-y-1 sm:space-y-2">
                        <li>**✨ 分析結果洞察**：點擊此按鈕，Gemini AI 將對您當前的排行結果（主要基於歌曲和播放習慣）進行綜合分析，提供關於您的**收聽習慣和可能的曲風偏好**的洞察。</li>
                        <li>**✨ Gemini 推薦歌單**：當您在「排行項目」中選擇「歌曲名稱 - 歌手」時，此按鈕將可用。點擊它，您將可以選擇推薦類型。確認後，Gemini 會根據您的收聽數據（熱門歌曲、歌手、最近播放等）生成一個精選歌單，並在新頁面中以精美排版呈現。</li>
                        <li>**✨ 歌曲洞察**：在歌曲的詳細記錄頁面中，點擊此按鈕可讓 Gemini 分析並總結該歌曲的主題、歌詞意義或整體氛圍。</li>
                        <li>**✨ 歌手洞察**：在歌手的詳細資料頁面中，點擊此按鈕可讓 Gemini 概述該歌手的音樂風格、主要影響及對音樂的整體影響。</li>
                        <li>**✨ 播放回顧 (Recap)**：點擊此按鈕將彈出一個日期選擇框。您可以選擇回顧的日期範圍，或選擇分析所有資料。確認後，Gemini 將為您生成個人化的音樂回顧，並在新頁面中以精美排版呈現。</li>
                    </ul>
                </div>

                <div className="flex justify-center mt-6 sm:mt-8">
                    <button
                        onClick={onBack}
                        className="px-6 py-3 sm:px-8 sm:py-4 bg-gradient-to-r from-indigo-600 to-purple-700 text-white font-semibold rounded-2xl shadow-xl hover:from-indigo-700 hover:to-purple-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 transition duration-300 ease-in-out transform hover:scale-105 active:scale-95 text-base sm:text-lg"
                    >
                        返回主分析器
                    </button>
                </div>
            </div>
        );
    };

    const RecapPage = ({ data, isLoading, onBack }) => {
        if (isLoading) {
            return (
                <div className="flex flex-col items-center justify-center min-h-[500px] bg-gradient-to-br from-gray-900 to-black text-white rounded-3xl shadow-xl p-8">
                    <div className="animate-spin rounded-full h-20 w-20 border-t-4 border-b-4 border-purple-500"></div>
                    <p className="mt-6 text-xl font-semibold">正在生成您的音樂回顧，請稍候...</p>
                    <p className="mt-2 text-md text-gray-400">這可能需要幾秒鐘</p>
                </div>
            );
        }

        if (!data) {
            return (
                <div className="flex flex-col items-center justify-center min-h-[500px] bg-gradient-to-br from-gray-900 to-black text-white rounded-3xl shadow-xl p-8">
                    <p className="text-xl font-semibold">沒有回顧數據可顯示。請先載入檔案並生成回顧。</p>
                    <button
                        onClick={onBack}
                        className="mt-8 px-6 py-3 bg-gradient-to-r from-indigo-600 to-purple-700 text-white font-semibold rounded-2xl shadow-xl hover:from-indigo-700 hover:to-purple-800 transition duration-300 ease-in-out transform hover:scale-105 active:scale-95"
                    >
                        返回主分析器
                    </button>
                </div>
            );
        }

        const renderCard = (title, content, type, cardData) => {
            let bgColor = "from-red-600 to-pink-700";
            let textColor = "text-white";
            let contentJsx;

            if (type === 'totalMinutes') {
                bgColor = "from-blue-600 to-purple-700";
                contentJsx = (
                    <>
                        <p className="text-5xl md:text-6xl font-bold mb-2 drop-shadow-lg">{cardData.value}</p>
                        <p className="text-3xl md:text-4xl mb-4 opacity-80">{cardData.unit}</p>
                        <p className="text-sm md:text-base opacity-70 mb-4">{cardData.subText}</p>
                        {cardData.biggestListeningDay.date !== "N/A" && (
                            <p className="text-sm md:text-base font-semibold">
                                最高收聽日: {cardData.biggestListeningDay.date} ({cardData.biggestListeningDay.minutes} 分鐘)
                            </p>
                        )}
                    </>
                );
            } else if (type === 'topSongs') {
                bgColor = "from-green-600 to-emerald-700";
                contentJsx = (
                    <ol className="list-decimal list-inside text-lg md:text-xl space-y-2">
                        {cardData.songs.map((song, index) => (
                            <li key={index} className="flex items-center">
                                <span className="font-semibold w-6 shrink-0">{song.rank}.</span>
                                <span className="flex-grow pl-2 truncate">{song.song} - {song.artist}</span>
                            </li>
                        ))}
                    </ol>
                );
            } else if (type === 'topArtists') {
                bgColor = "from-orange-600 to-red-700";
                contentJsx = (
                    <ol className="list-decimal list-inside text-lg md:text-xl space-y-2">
                        {cardData.artists.map((artist, index) => (
                            <li key={index} className="flex items-center">
                                <span className="font-semibold w-6 shrink-0">{artist.rank}.</span>
                                <span className="flex-grow pl-2 truncate">{artist.artist}</span>
                            </li>
                        ))}
                    </ol>
                );
            } else if (type === 'wordsToDescribe') {
                bgColor = "from-teal-600 to-cyan-700";
                contentJsx = (
                    <>
                        <div className="flex flex-wrap justify-center gap-2 mb-4">
                            {cardData.words.map((word, index) => (
                                <span key={index} className="px-4 py-2 bg-white bg-opacity-20 rounded-full text-sm md:text-base font-semibold shadow-md">
                                    {word}
                                </span>
                            ))}
                        </div>
                        <p className="text-sm md:text-base text-center opacity-80">{cardData.description}</p>
                    </>
                );
            } else if (type === 'musicEvolution') {
                bgColor = "from-purple-600 to-pink-700";
                contentJsx = (
                    <p className="text-base md:text-lg text-center leading-relaxed">{cardData.description}</p>
                );
            } else { // Generic content
                contentJsx = <p className="text-base md:text-lg text-center leading-relaxed">{content}</p>;
            }

            return (
                <div className={`relative bg-gradient-to-br ${bgColor} ${textColor} rounded-2xl p-6 md:p-8 shadow-xl flex flex-col items-center justify-center text-center transform hover:scale-105 transition-transform duration-300 ease-in-out`}>
                    <h3 className="text-2xl md:text-3xl font-bold mb-4 drop-shadow">{title}</h3>
                    {contentJsx}
                </div>
            );
        };

        return (
            <div className="bg-gradient-to-br from-gray-900 to-black text-white p-4 sm:p-6 rounded-3xl shadow-xl w-full mx-auto max-w-full lg:max-w-7xl min-h-[calc(100vh-100px)] flex flex-col">
                <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold text-center mb-6 sm:mb-10 drop-shadow-xl text-gradient-to-r from-purple-400 via-pink-400 to-blue-400">
                    {data.recapTitle || "您的音樂回顧"}
                </h1>
                
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 sm:gap-8 flex-grow">
                    {data.totalMinutesListenedCard && renderCard(data.totalMinutesListenedCard.title, null, 'totalMinutes', data.totalMinutesListenedCard)}
                    {data.topSongsCard && renderCard(data.topSongsCard.title, null, 'topSongs', data.topSongsCard)}
                    {data.topArtistsCard && renderCard(data.topArtistsCard.title, null, 'topArtists', data.topArtistsCard)}
                    {data.wordsToDescribeCard && renderCard(data.wordsToDescribeCard.title, null, 'wordsToDescribe', data.wordsToDescribeCard)}
                    {data.musicEvolutionCard && renderCard(data.musicEvolutionCard.title, null, 'musicEvolution', data.musicEvolutionCard)}
                    
                    {/* Placeholder Card (Optional, for visual balance if needed) */}
                    <div className="relative bg-gradient-to-br from-gray-800 to-gray-900 text-gray-500 rounded-2xl p-6 md:p-8 shadow-xl flex flex-col items-center justify-center text-center">
                        <h3 className="text-2xl md:text-3xl font-bold mb-4 drop-shadow">更多洞察即將推出...</h3>
                        <p className="text-base md:text-lg opacity-70">敬請期待未來的更新！</p>
                    </div>
                </div>

                <div className="flex justify-center mt-8 sm:mt-12">
                    <button
                        onClick={onBack}
                        className="px-6 py-3 sm:px-8 sm:py-4 bg-gradient-to-r from-indigo-600 to-purple-700 text-white font-semibold rounded-2xl shadow-xl hover:from-indigo-700 hover:to-purple-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 transition duration-300 ease-in-out transform hover:scale-105 active:scale-95"
                    >
                        返回主分析器
                    </button>
                </div>
            </div>
        );
    };

    const RecommendationPage = ({ data, isLoading, onBack }) => {
        if (isLoading) {
            return (
                <div className="flex flex-col items-center justify-center min-h-[500px] bg-gradient-to-br from-gray-900 to-black text-white rounded-3xl shadow-xl p-8">
                    <div className="animate-spin rounded-full h-20 w-20 border-t-4 border-b-4 border-purple-500"></div>
                    <p className="mt-6 text-xl font-semibold">正在生成您的推薦歌單，請稍候...</p>
                    <p className="mt-2 text-md text-gray-400">這可能需要一些時間</p>
                </div>
            );
        }

        if (!data || !data.recommendations || data.recommendations.length === 0) {
            return (
                <div className="flex flex-col items-center justify-center min-h-[500px] bg-gradient-to-br from-gray-900 to-black text-white rounded-3xl shadow-xl p-8">
                    <p className="text-xl font-semibold">目前沒有推薦歌單數據可顯示。請嘗試重新生成。</p>
                    <button
                        onClick={onBack}
                        className="mt-8 px-6 py-3 bg-gradient-to-r from-indigo-600 to-purple-700 text-white font-semibold rounded-2xl shadow-xl hover:from-indigo-700 hover:to-purple-800 transition duration-300 ease-in-out transform hover:scale-105 active:scale-95"
                    >
                        返回主分析器
                    </button>
                </div>
            );
        }

        return (
            <div className="bg-gradient-to-br from-gray-900 to-black text-white p-4 sm:p-6 rounded-3xl shadow-xl w-full mx-auto max-w-full lg:max-w-7xl min-h-[calc(100vh-100px)] flex flex-col">
                <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold text-center mb-6 sm:mb-10 drop-shadow-xl text-gradient-to-r from-green-400 via-teal-400 to-cyan-400">
                    {data.playlistTitle || "推薦歌單"}
                </h1>
                <p className="text-lg md:text-xl text-center mb-8 opacity-80 leading-relaxed">{data.description || "根據您的收聽習慣，為您精選。"}</p>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6 flex-grow">
                    {data.recommendations.map((item, index) => (
                        <div key={index} className="bg-gradient-to-br from-gray-800 to-gray-700 rounded-xl p-4 shadow-lg hover:shadow-xl transition-all duration-300 ease-in-out transform hover:scale-105 flex flex-col justify-between">
                            <h3 className="text-lg sm:text-xl font-semibold mb-2 text-cyan-300 truncate">{item.song || "未知歌曲"}</h3>
                            <p className="text-sm sm:text-base text-gray-300 truncate mb-3">{item.artist || "未知藝術家"}</p>
                            <div className="flex justify-end mt-auto">
                                <button
                                    onClick={() => openExternalLink(`https://www.youtube.com/results?search_query=${encodeURIComponent(item.song + ' ' + item.artist + ' official audio')}`)}
                                    className="text-xs px-3 py-1 bg-gradient-to-r from-red-600 to-rose-700 text-white rounded-full shadow-md hover:from-red-700 hover:to-rose-800 transition transform hover:scale-110 active:scale-95"
                                >
                                    在 YouTube 上搜尋
                                </button>
                            </div>
                        </div>
                    ))}
                </div>

                <div className="flex justify-center mt-8 sm:mt-12">
                    <button
                        onClick={onBack}
                        className="px-6 py-3 sm:px-8 sm:py-4 bg-gradient-to-r from-indigo-600 to-purple-700 text-white font-semibold rounded-2xl shadow-xl hover:from-indigo-700 hover:to-purple-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 transition duration-300 ease-in-out transform hover:scale-105 active:scale-95"
                    >
                        返回主分析器
                    </button>
                </div>
            </div>
        );
    };


    return (
        <div className="min-h-screen bg-gradient-to-br from-gray-200 to-gray-300 p-4 sm:p-6 font-inter text-gray-800">
            <style>
                {`
                @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
                body {
                    font-family: 'Inter', sans-serif;
                }
                .tooltip {
                    position: relative;
                    display: inline-block;
                }
                .tooltip .tooltiptext {
                    visibility: hidden;
                    width: 120px;
                    background-color: #333;
                    color: #fff;
                    text-align: center;
                    border-radius: 6px;
                    padding: 5px 0;
                    position: absolute;
                    z-index: 1000;
                    bottom: 125%; /* Tooltip above the element */
                    left: 50%;
                    margin-left: -60px;
                    opacity: 0;
                    transition: opacity 0.3s;
                }
                .tooltip .tooltiptext::after {
                    content: "";
                    position: absolute;
                    top: 100%;
                    left: 50%;
                    margin-left: -5px;
                    border-width: 5px;
                    border-style: solid;
                    border-color: #333 transparent transparent transparent;
                }
                .tooltip:hover .tooltiptext {
                    visibility: visible;
                    opacity: 1;
                }
                .treeview-container {
                    overflow: auto;
                    border: 1px solid #e2e8f0; /* gray-300 */
                    border-radius: 0.375rem; /* rounded-md */
                    flex-grow: 1;
                }
                .treeview-table {
                    width: 100%;
                    border-collapse: collapse;
                }
                .treeview-table th, .treeview-table td {
                    padding: 0.5rem 1rem;
                    text-align: left;
                    white-space: nowrap;
                    border-bottom: 1px solid #e2e8f0;
                }
                .treeview-table th {
                    background-color: #f8fafc; /* gray-50 */
                    font-size: 0.75rem; /* text-xs */
                    font-weight: 500; /* font-medium */
                    color: #64748b; /* text-gray-500 */
                    text-transform: uppercase;
                    letter-spacing: 0.05em; /* tracking-wider */
                    position: sticky;
                    top: 0;
                    z-index: 10;
                }
                .treeview-table tbody tr:hover {
                    background-color: #f9fafb; /* hover:bg-gray-50 */
                }
                .treeview-table tbody tr:last-child td {
                    border-bottom: none;
                }
                .text-right {
                    text-align: right;
                }
                .text-center {
                    text-align: center;
                }
                .text-gradient-to-r {
                    background-image: linear-gradient(to right, var(--tw-gradient-stops));
                    -webkit-background-clip: text;
                    -webkit-text-fill-color: transparent;
                }
                `}
            </style>

            {/* 導航按鈕 */}
            <div className="flex justify-center mb-6 sm:mb-8 space-x-3 sm:space-x-4">
                <button
                    onClick={() => setCurrentPage('analyzer')}
                    className={`px-5 py-2 sm:px-6 sm:py-3 rounded-xl shadow-lg font-semibold transition transform hover:scale-105 active:scale-95 text-sm sm:text-base ${currentPage === 'analyzer' ? 'bg-gradient-to-r from-blue-600 to-indigo-700 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}
                >
                    主分析器
                </button>
                <button
                    onClick={() => setCurrentPage('how-to-use')}
                    className={`px-5 py-2 sm:px-6 sm:py-3 rounded-xl shadow-lg font-semibold transition transform hover:scale-105 active:scale-95 text-sm sm:text-base ${currentPage === 'how-to-use' ? 'bg-gradient-to-r from-blue-600 to-indigo-700 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}
                >
                    使用說明
                </button>
                 <button
                    onClick={() => {
                        // Recap is now independent, just check if files are loaded
                        if (allStreamingDataOriginal.length === 0) {
                            alert("請先載入您的 Spotify 播放記錄檔案才能生成回顧。");
                            return;
                        }
                        // Open the date selection modal for recap
                        setIsRecapDateSelectModalOpen(true); 
                    }}
                    className={`px-5 py-2 sm:px-6 sm:py-3 rounded-xl shadow-lg font-semibold transition transform hover:scale-105 active:scale-95 text-sm sm:text-base ${currentPage === 'recap' ? 'bg-gradient-to-r from-blue-600 to-indigo-700 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}
                    disabled={allStreamingDataOriginal.length === 0}
                >
                    播放回顧 (Recap)
                </button>
            </div>

            {/* 根據 currentPage 渲染不同頁面 */}
            {currentPage === 'analyzer' && (
                <div className="bg-white p-4 sm:p-8 rounded-2xl sm:rounded-3xl shadow-xl w-full mx-auto max-w-full sm:max-w-3xl md:max-w-5xl lg:max-w-7xl">
                    <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold text-center text-gray-900 mb-4 sm:mb-8 tracking-wide">Spotify 播放記錄分析器</h1>

                    {/* 檔案選取區 */}
                    <div className="mb-6 sm:mb-8 p-4 sm:p-6 border border-gray-200 rounded-2xl bg-gray-50 shadow-md">
                        <h2 className="text-xl sm:text-2xl font-semibold text-gray-700 mb-3 sm:mb-4">檔案選取</h2>
                        <div className="flex flex-col md:flex-row items-center space-y-3 md:space-y-0 md:space-x-6">
                            <input
                                type="file"
                                ref={fileInputRef}
                                multiple
                                accept=".json"
                                onChange={handleFileChange}
                                className="hidden"
                                id="file-upload"
                            />
                            <label
                                htmlFor="file-upload"
                                className="inline-flex items-center justify-center px-6 py-3 sm:px-8 sm:py-3 text-base sm:text-lg font-medium rounded-xl text-white bg-gradient-to-r from-indigo-600 to-purple-700 hover:from-indigo-700 hover:to-purple-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 cursor-pointer transition duration-300 ease-in-out shadow-lg hover:shadow-xl transform hover:scale-105 active:scale-95"
                            >
                                選擇 JSON 檔案
                            </label>
                            <span className="text-gray-700 text-base sm:text-xl flex-shrink-0">{selectedFilesLabel}</span>
                            <div className="w-full h-3 bg-gray-200 rounded-full overflow-hidden flex-grow shadow-inner">
                                <div
                                    className="h-full bg-gradient-to-r from-blue-400 to-blue-600 rounded-full transition-all duration-300 ease-out"
                                    style={{ width: `${progress}%` }}
                                ></div>
                            </div>
                        </div>
                    </div>

                    {/* 篩選條件區 */}
                    <div className="mb-6 sm:mb-8 p-4 sm:p-6 border border-gray-200 rounded-2xl bg-gray-50 shadow-md">
                        <h2 className="text-xl sm:text-2xl font-semibold text-gray-700 mb-3 sm:mb-4">篩選與排行條件</h2>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6 mb-4 sm:mb-6">
                            {/* 日期篩選 */}
                            <div className="flex flex-col space-y-2 sm:space-y-3">
                                <div className="flex items-center space-x-2">
                                    <input
                                        type="checkbox"
                                        id="dateFilter"
                                        checked={dateFilterEnabled}
                                        onChange={(e) => setDateFilterEnabled(e.target.checked)}
                                        className="form-checkbox h-4 w-4 sm:h-5 sm:w-5 text-indigo-600 rounded focus:ring-indigo-500"
                                    />
                                    <label htmlFor="dateFilter" className="text-gray-700 font-medium text-base sm:text-lg">依日期篩選?</label>
                                </div>
                                <div className="flex items-center space-x-2">
                                    <label htmlFor="startDate" className="text-gray-700 text-sm sm:text-base">開始日期 (YYYYMMDD):</label>
                                    <input
                                        type="text"
                                        id="startDate"
                                        className={`p-2 sm:p-3 border rounded-lg w-full text-sm sm:text-base ${dateFilterEnabled ? 'border-gray-300 bg-white' : 'bg-gray-100 border-gray-200 cursor-not-allowed'} focus:ring-blue-500 focus:border-blue-500 transition duration-200 shadow-sm`}
                                        value={startDate}
                                        onChange={(e) => setStartDate(e.target.value)}
                                        disabled={!dateFilterEnabled}
                                        placeholder="20230101"
                                        title="請輸入YYYYMMDD 格式的日期，例如 20230101"
                                    />
                                </div>
                                <div className="flex items-center space-x-2">
                                    <label htmlFor="endDate" className="text-gray-700 text-sm sm:text-base">結束日期 (YYYYMMDD):</label>
                                    <input
                                        type="text"
                                        id="endDate"
                                        className={`p-2 sm:p-3 border rounded-lg w-full text-sm sm:text-base ${dateFilterEnabled ? 'border-gray-300 bg-white' : 'bg-gray-100 border-gray-200 cursor-not-allowed'} focus:ring-blue-500 focus:border-blue-500 transition duration-200 shadow-sm`}
                                        value={endDate}
                                        onChange={(e) => setEndDate(e.target.value)}
                                        disabled={!dateFilterEnabled}
                                        placeholder="20231231"
                                        title="請輸入YYYYMMDD 格式的日期，例如 20231231"
                                    />
                                </div>
                            </div>

                            {/* 排行項目與數量 */}
                            <div className="flex flex-col space-y-2 sm:space-y-3">
                                <label htmlFor="rankingField" className="text-gray-700 text-base sm:text-lg">排行項目:</label>
                                <select
                                    id="rankingField"
                                    value={rankingField}
                                    onChange={handleRankingFieldChange}
                                    className={`p-2 sm:p-3 border rounded-lg w-full text-sm sm:text-base ${trendAnalysisType !== "無" ? 'bg-gray-100 border-gray-200 cursor-not-allowed' : 'border-gray-300 bg-white'} focus:ring-blue-500 focus:border-blue-500 transition duration-200 shadow-sm`}
                                    disabled={trendAnalysisType !== "無"}
                                    title="選擇您希望分析的播放記錄類型"
                                >
                                    {Object.values(FIELD_MAPPING).map(([key, name]) => (
                                        <option key={key} value={name}>{name}</option>
                                    ))}
                                </select>
                                <label htmlFor="numResults" className="text-gray-700 text-base sm:text-lg">顯示數量:</label>
                                <input
                                    type="text"
                                    id="numResults"
                                    className="p-2 sm:p-3 border border-gray-300 rounded-lg w-full text-sm sm:text-base focus:ring-blue-500 focus:border-blue-500 transition duration-200 shadow-sm"
                                    value={numResults}
                                    onChange={(e) => {
                                        const value = e.target.value;
                                        if (value.toLowerCase() === 'all' || value === '' || /^\d+$/.test(value)) {
                                            setNumResults(value);
                                        }
                                    }}
                                    placeholder="all"
                                    title="輸入數字顯示前 N 個結果，或輸入 'all' 顯示所有結果"
                                />
                            </div>

                            {/* 排行標準 */}
                            <div className="flex flex-col space-y-2 sm:space-y-3">
                                <span className="text-gray-700 text-base sm:text-lg">排行標準:</span>
                                <div className="flex flex-col space-y-1 sm:space-y-2">
                                    <label className="inline-flex items-center">
                                        <input
                                            type="radio"
                                            className="form-radio text-indigo-600 h-4 w-4 sm:h-5 sm:w-5"
                                            name="rankMetric"
                                            value="count"
                                            checked={rankMetric === "count"}
                                            onChange={(e) => setRankMetric(e.target.value)}
                                            disabled={trendAnalysisType !== "無"}
                                        />
                                        <span className="ml-2 text-gray-700 text-sm sm:text-base">播放次數</span>
                                    </label>
                                    <label className="inline-flex items-center">
                                        <input
                                            type="radio"
                                            className="form-radio text-indigo-600 h-4 w-4 sm:h-5 sm:w-5"
                                            name="rankMetric"
                                            value="duration"
                                            checked={rankMetric === "duration"}
                                            onChange={(e) => setRankMetric(e.target.value)}
                                            disabled={trendAnalysisType !== "無"}
                                        />
                                        <span className="ml-2 text-gray-700 text-sm sm:text-base">總播放時長</span>
                                    </label>
                                    <label className="inline-flex items-center">
                                        <input
                                            type="radio"
                                            className="form-radio text-indigo-600 h-4 w-4 sm:h-5 sm:w-5"
                                            name="rankMetric"
                                            value="avg_duration"
                                            checked={rankMetric === "avg_duration"}
                                            onChange={(e) => setRankMetric(e.target.value)}
                                            disabled={trendAnalysisType !== "無"}
                                        />
                                        <span className="ml-2 text-gray-700 text-sm sm:text-base">平均播放時長</span>
                                    </label>
                                </div>
                                {/* 趨勢分析選項 */}
                                <label htmlFor="trendAnalysis" className="text-gray-700 text-base sm:text-lg mt-3 sm:mt-4">趨勢分析:</label>
                                <select
                                    id="trendAnalysis"
                                    value={trendAnalysisType}
                                    onChange={handleTrendAnalysisChange}
                                    className="p-2 sm:p-3 border border-gray-300 rounded-lg w-full text-sm sm:text-base focus:ring-blue-500 focus:border-blue-500 transition duration-200 shadow-sm"
                                    title="選擇您希望進行的趨勢分析類型"
                                >
                                    {Object.values(TREND_ANALYSIS_TYPES).map((type) => (
                                        <option key={type} value={type}>{type}</option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        {/* 主結果搜尋框 */}
                        <div className="flex flex-col md:flex-row items-center space-y-3 md:space-y-0 md:space-x-4 mt-4 sm:mt-6">
                            <label htmlFor="mainSearch" className="text-gray-700 text-base sm:text-lg flex-shrink-0">搜尋結果 (歌曲/專輯):</label>
                            <input
                                type="text"
                                id="mainSearch"
                                className={`flex-grow p-2 sm:p-3 border rounded-lg text-sm sm:text-base ${mainSearchEnabled ? 'border-gray-300 bg-white' : 'bg-gray-100 border-gray-200 cursor-not-allowed'} focus:ring-blue-500 focus:border-blue-500 transition duration-200 shadow-sm`}
                                value={mainSearchTerm}
                                onChange={(e) => setMainSearchTerm(e.target.value)}
                                disabled={!mainSearchEnabled}
                                placeholder="輸入關鍵字搜尋..."
                            />
                            <button
                                onClick={filterMainResults}
                                className={`px-4 py-2 sm:px-6 sm:py-3 bg-gradient-to-r from-blue-500 to-blue-700 text-white rounded-xl shadow-lg hover:from-blue-600 hover:to-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition duration-300 ease-in-out transform hover:scale-105 active:scale-95 text-sm sm:text-base ${!mainSearchEnabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                                disabled={!mainSearchEnabled}
                            >
                                搜尋
                            </button>
                            <button
                                onClick={clearMainSearch}
                                className={`px-4 py-2 sm:px-6 sm:py-3 bg-gradient-to-r from-gray-400 to-gray-600 text-gray-900 rounded-xl shadow-lg hover:from-gray-500 hover:to-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 transition duration-300 ease-in-out transform hover:scale-105 active:scale-95 text-sm sm:text-base ${!mainSearchEnabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                                disabled={!mainSearchEnabled}
                            >
                                清除搜尋
                            </button>
                        </div>
                    </div>

                    {/* 操作按鈕 */}
                    <div className="mb-6 sm:mb-8 flex flex-col md:flex-row justify-center space-y-3 md:space-y-0 md:space-x-6">
                        <button
                            onClick={analyzeData}
                            className="px-6 py-3 sm:px-8 sm:py-4 bg-gradient-to-r from-green-600 to-emerald-700 text-white font-semibold rounded-2xl shadow-xl hover:from-green-700 hover:to-emerald-800 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 transition duration-300 ease-in-out transform hover:scale-105 active:scale-95 text-base sm:text-lg"
                        >
                            開始分析
                        </button>
                        <button
                            onClick={exportToCsv}
                            className="px-6 py-3 sm:px-8 sm:py-4 bg-gradient-to-r from-purple-600 to-indigo-700 text-white font-semibold rounded-2xl shadow-xl hover:from-purple-700 hover:to-indigo-800 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 transition duration-300 ease-in-out transform hover:scale-105 active:scale-95 text-base sm:text-lg"
                            disabled={currentlyDisplayedRankedItems.length === 0}
                        >
                            匯出 CSV
                        </button>
                        <button
                            onClick={resetAppState}
                            className="px-6 py-3 sm:px-8 sm:py-4 bg-gradient-to-r from-red-600 to-rose-700 text-white font-semibold rounded-2xl shadow-xl hover:from-red-700 hover:to-rose-800 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 transition duration-300 ease-in-out transform hover:scale-105 active:scale-95 text-base sm:text-lg"
                            title="清除所有載入的數據和篩選條件，重設應用程式狀態"
                        >
                            重設
                        </button>
                    </div>

                    {/* Gemini AI 主介面按鈕 */}
                    <div className="mb-6 sm:mb-8 p-4 sm:p-6 border border-gray-200 rounded-2xl bg-gray-50 shadow-md flex flex-col sm:flex-row justify-center gap-3 sm:gap-6">
                        <button
                            onClick={triggerGeminiAnalysis}
                            className="px-6 py-3 sm:px-8 sm:py-4 bg-gradient-to-r from-blue-600 to-cyan-700 text-white font-semibold rounded-2xl shadow-xl hover:from-blue-700 hover:to-cyan-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition duration-300 ease-in-out transform hover:scale-105 active:scale-95 text-base sm:text-lg"
                            disabled={currentlyDisplayedRankedItems.length === 0}
                        >
                            ✨ 分析結果洞察
                        </button>
                        {rankingField === FIELD_MAPPING[1][1] && (
                            <button
                                onClick={() => {
                                    if (allStreamingDataOriginal.length === 0) {
                                        alert("請先載入您的 Spotify 播放記錄檔案才能生成推薦歌單。");
                                        return;
                                    }
                                    setIsRecommendationChoiceModalOpen(true); // Open the choice modal
                                }}
                                className="px-6 py-3 sm:px-8 sm:py-4 bg-gradient-to-r from-pink-600 to-red-700 text-white font-semibold rounded-2xl shadow-xl hover:from-pink-700 hover:to-red-800 focus:outline-none focus:ring-2 focus:ring-pink-500 focus:ring-offset-2 transition duration-300 ease-in-out transform hover:scale-105 active:scale-95 text-base sm:text-lg"
                                disabled={allStreamingDataOriginal.length === 0} // Only needs file loaded now
                            >
                                ✨ Gemini 推薦歌單
                            </button>
                        )}
                    </div>

                    {/* 結果顯示區 */}
                    <div className="p-4 sm:p-6 border border-gray-200 rounded-2xl bg-gray-50 shadow-md flex flex-col min-h-[350px]">
                        <h2 className="text-xl sm:text-2xl font-semibold text-gray-700 mb-3 sm:mb-4">分析結果 (單擊「單曲」、「歌曲名稱-歌手」、「專輯」或「歌手」項目可查看詳細資料)</h2>
                        <div className="flex-grow overflow-auto rounded-xl border border-gray-300 shadow-inner">
                            <table className="treeview-table text-xs sm:text-sm">
                                <thead>
                                    {trendAnalysisType === "無" ? (
                                        <tr>
                                            <th className="w-16 px-2 py-2 sm:px-4 sm:py-3">排名</th>
                                            {currentFieldToRankKey === "master_metadata_track_name" && (
                                                <>
                                                    <th className="w-64 px-2 py-2 sm:px-4 sm:py-3">歌曲名稱</th>
                                                    <th className="w-40 px-2 py-2 sm:px-4 sm:py-3">歌手</th>
                                                </>
                                            )}
                                            {currentFieldToRankKey === "master_metadata_album_album_name" && (
                                                <>
                                                    <th className="w-64 px-2 py-2 sm:px-4 sm:py-3">專輯名稱</th>
                                                    <th className="w-40 px-2 py-2 sm:px-4 sm:py-3">歌手</th>
                                                </>
                                            )}
                                            {currentFieldToRankKey === "spotify_track_uri" && (
                                                <th className="w-80 px-2 py-2 sm:px-4 sm:py-3">單曲 (URI)</th>
                                            )}
                                            {currentFieldToRankKey === "master_metadata_album_artist_name" && (
                                                <th className="w-64 px-2 py-2 sm:px-4 sm:py-3">歌手</th>
                                            )}
                                            {currentFieldToRankKey === "ms_played" && (
                                                <th className="w-80 px-2 py-2 sm:px-4 sm:py-3">歌曲/專輯/URI</th>
                                            )}
                                            {!["master_metadata_track_name", "master_metadata_album_album_name", "spotify_track_uri", "master_metadata_album_artist_name", "ms_played"].includes(currentFieldToRankKey) && (
                                                <th className="w-64 px-2 py-2 sm:px-4 sm:py-3">{rankingField.split(" - ")[0]}</th>
                                            )}

                                            {rankMetric === "count" && <th className="w-40 px-2 py-2 sm:px-4 sm:py-3 text-right">次數</th>}
                                            {rankMetric === "duration" && <th className="w-40 px-2 py-2 sm:px-4 sm:py-3 text-right">總時長</th>}
                                            {rankMetric === "avg_duration" && <th className="w-40 px-2 py-2 sm:px-4 sm:py-3 text-right">平均時長</th>}

                                            {(rankMetric !== "duration" || currentFieldToRankKey === "ms_played") && <th className="w-40 px-2 py-2 sm:px-4 sm:py-3 text-right">總時長(輔助)</th>}
                                            {(rankMetric !== "avg_duration" || currentFieldToRankKey === "ms_played") && <th className="w-40 px-2 py-2 sm:px-4 sm:py-3 text-right">平均時長(輔助)</th>}
                                            {currentFieldToRankKey !== "ms_played" && rankMetric !== "count" && <th className="w-40 px-2 py-2 sm:px-4 sm:py-3 text-right">播放次數(輔助)</th>}
                                        </tr>
                                    ) : (
                                        <tr>
                                            <th className="w-40 px-2 py-2 sm:px-4 sm:py-3">月份</th>
                                            {trendAnalysisType === TREND_ANALYSIS_TYPES.monthly_total_duration && (
                                                <>
                                                    <th className="w-64 px-2 py-2 sm:px-4 sm:py-3 text-right">總收聽時長</th>
                                                </>
                                            )}
                                            {trendAnalysisType === TREND_ANALYSIS_TYPES.monthly_top_songs && (
                                                <th className="w-full px-2 py-2 sm:px-4 sm:py-3">每月熱門歌曲 (前{parseInt(numResults, 10) || 5}名)</th>
                                            )}
                                            {trendAnalysisType === TREND_ANALYSIS_TYPES.monthly_top_artists && (
                                                <th className="w-full px-2 py-2 sm:px-4 sm:py-3">每月熱門歌手 (前{parseInt(numResults, 10) || 5}名)</th>
                                            )}
                                        </tr>
                                    )}
                                </thead>
                                <tbody>
                                    {currentlyDisplayedRankedItems.length === 0 && (
                                        <tr>
                                            <td colSpan="100%" className="px-4 py-4 text-center text-gray-500 text-sm sm:text-base">
                                                沒有數據可顯示。請選擇 JSON 檔案並點擊「開始分析」。
                                            </td>
                                        </tr>
                                    )}
                                    {currentlyDisplayedRankedItems.map((item, index) => {
                                        if (trendAnalysisType !== "無") {
                                            return (
                                                <tr key={index} className="hover:bg-gray-100">
                                                    <td className="px-2 py-1 sm:px-4 sm:py-2 whitespace-nowrap text-xs sm:text-sm text-gray-800">{item[0]}</td>
                                                    <td className="px-2 py-1 sm:px-4 sm:py-2 whitespace-normal text-xs sm:text-sm text-gray-800">
                                                        {trendAnalysisType === TREND_ANALYSIS_TYPES.monthly_total_duration ? item[1] : item[1]}
                                                    </td>
                                                </tr>
                                            );
                                        } else {
                                            const [item_data, primary_metric, total_ms, count] = item;
                                            const rankNum = index + 1;

                                            let primaryMetricDisplay = primary_metric;
                                            if (rankMetric === "duration" || rankMetric === "avg_duration") {
                                                primaryMetricDisplay = formatMsToMinSec(primary_metric);
                                            }
                                            const totalDurationStr = formatMsToMinSec(total_ms);
                                            const avgDurationStr = formatMsToMinSec(item[4]);

                                            let displayCells = [
                                                <td key="rank" className="px-2 py-1 sm:px-4 sm:py-2 whitespace-nowrap text-xs sm:text-sm text-gray-800 text-center">{rankNum}</td>
                                            ];

                                            if (currentFieldToRankKey === "master_metadata_track_name" ||
                                                currentFieldToRankKey === "master_metadata_album_album_name") {
                                                const [name, artist] = item_data.split(' - ');
                                                displayCells.push(
                                                    <td key="name" className="px-2 py-1 sm:px-4 sm:py-2 whitespace-nowrap text-xs sm:text-sm text-gray-800">{name}</td>,
                                                    <td key="artist" className="px-2 py-1 sm:px-4 sm:py-2 whitespace-nowrap text-xs sm:text-sm text-gray-800">{artist}</td>
                                                );
                                            } else if (currentFieldToRankKey === "spotify_track_uri" || currentFieldToRankKey === "master_metadata_album_artist_name" ||
                                                (!["master_metadata_track_name", "master_metadata_album_album_name", "ms_played"].includes(currentFieldToRankKey))) {
                                                displayCells.push(
                                                    <td key="item" className="px-2 py-1 sm:px-4 sm:py-2 whitespace-nowrap text-xs sm:text-sm text-gray-800">{String(item_data)}</td>
                                                );
                                            } else if (currentFieldToRankKey === "ms_played") {
                                                displayCells.push(
                                                    <td key="item" className="px-2 py-1 sm:px-4 sm:py-2 whitespace-nowrap text-xs sm:text-sm text-gray-800">{String(item_data)}</td>
                                                );
                                            }

                                            if (currentFieldToRankKey === "ms_played") {
                                                displayCells.push(
                                                    <td key="primary_metric" className="px-2 py-1 sm:px-4 sm:py-2 whitespace-nowrap text-xs sm:text-sm text-gray-800 text-right">{formatMsToMinSec(primary_metric)}</td>,
                                                    <td key="count_aux" className="px-2 py-1 sm:px-4 sm:py-2 whitespace-nowrap text-xs sm:text-sm text-gray-800 text-right">{count}</td>,
                                                    <td key="avg_duration_aux" className="px-2 py-1 sm:px-4 sm:py-2 whitespace-nowrap text-xs sm:text-sm text-gray-800 text-right">{avgDurationStr}</td>
                                                );
                                            } else {
                                                displayCells.push(
                                                    <td key="primary_metric" className="px-2 py-1 sm:px-4 sm:py-2 whitespace-nowrap text-xs sm:text-sm text-gray-800 text-right">{primaryMetricDisplay}</td>
                                                );
                                                // Conditional auxiliary columns
                                                if (rankMetric !== "duration") {
                                                    displayCells.push(<td key="total_duration_aux" className="px-2 py-1 sm:px-4 sm:py-2 whitespace-nowrap text-xs sm:text-sm text-gray-800 text-right">{totalDurationStr}</td>);
                                                }
                                                if (rankMetric !== "avg_duration") {
                                                    displayCells.push(<td key="avg_duration_aux" className="px-2 py-1 sm:px-4 sm:py-2 whitespace-nowrap text-xs sm:text-sm text-gray-800 text-right">{avgDurationStr}</td>);
                                                }
                                                if (rankMetric !== "count") {
                                                    displayCells.push(<td key="count_aux" className="px-2 py-1 sm:px-4 sm:py-2 whitespace-nowrap text-xs sm:text-sm text-gray-800 text-right">{count}</td>);
                                                }
                                            }

                                            return (
                                                <tr key={index} className="hover:bg-gray-100 cursor-pointer" onClick={() => showListeningDetails(index)}>
                                                    {displayCells}
                                                </tr>
                                            );
                                        }
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <div className="mt-4 sm:mt-6 text-center text-gray-600 text-xs sm:text-sm">
                        {status}
                    </div>
                </div>
            )}

            {currentPage === 'how-to-use' && (
                <HowToUse onBack={() => setCurrentPage('analyzer')} />
            )}

            {currentPage === 'recap' && (
                <RecapPage data={recapData} isLoading={isRecapLoading} onBack={() => setCurrentPage('analyzer')} />
            )}

            {currentPage === 'recommendation' && (
                <RecommendationPage data={recommendationData} isLoading={isGeminiLoading} onBack={() => setCurrentPage('analyzer')} />
            )}


            {/* Recap Date Select Modal */}
            <RecapDateSelectModal
                isOpen={isRecapDateSelectModalOpen}
                onClose={() => setIsRecapDateSelectModalOpen(false)}
                onConfirm={handleRecapGeneration} // This will now receive localStartDate and localEndDate
                onApplyAllDataChange={setRecapApplyAllData}
                applyAllData={recapApplyAllData}
            />

            <DetailModal
                isOpen={isDetailModalOpen}
                onClose={() => setIsDetailModalOpen(false)}
                records={detailRecords}
                title={detailModalTitle}
                maxPlayTimes={detailMaxPlayTimes}
                searchTerm={detailSearchTerm}
                onSearchChange={setDetailSearchTerm}
                onSearch={() => {
                    setDetailSearchTerm(detailSearchTerm);
                }}
                onClearSearch={() => {
                    setDetailSearchTerm("");
                    setYoutubeVideoId(null); // Clear video when search is cleared
                }}
                onExport={() => exportDetailRecordsToCsv(detailRecords, detailModalTitle, detailMaxPlayTimes)}
                searchLyricsOnline={searchLyricsOnline}
                searchAlbumReviewOnline={searchAlbumReviewOnline}
                searchArtistBioOnline={searchArtistBioOnline}
                onSongInsight={(song, artist) => callGeminiAPI(`Given the song title '${song}' by '${artist}', provide a concise summary of its main themes, lyrical meaning, or general mood. Keep it under 150 words.`, `歌曲洞察: ${song}`)}
                youtubeVideoId={youtubeVideoId} // Pass YouTube video ID
                youtubeLoading={youtubeLoading} // Pass YouTube loading state
            />

            <ArtistModal
                isOpen={isArtistModalOpen}
                onClose={() => setIsArtistModalOpen(false)}
                artistName={artistName}
                albumsData={artistAlbumsData}
                songsData={artistSongsData}
                onAlbumSelect={handleArtistAlbumSelect}
                onSongDoubleClick={handleArtistSongDoubleClick}
                onArtistBioSearch={searchArtistBioOnline}
                onArtistInsight={(artist) => callGeminiAPI(`Given the artist name '${artist}', provide a concise overview of their musical style, key influences, and overall impact on music. Keep it under 200 words.`, `歌手洞察: ${artist}`)}
                isLoading={isArtistLoading} // Pass loading state to modal
            />

            <GeminiResponseModal
                isOpen={isGeminiModalOpen}
                onClose={() => setIsGeminiModalOpen(false)}
                title={geminiModalTitle}
                content={geminiModalContent}
                isLoading={isGeminiLoading}
            />

            <RecommendationChoiceModal
                isOpen={isRecommendationChoiceModalOpen}
                onClose={() => setIsRecommendationChoiceModalOpen(false)}
                onSelect={handlePlaylistRecommendation}
            />
        </div>
    );
};

export default App;
