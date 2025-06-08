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
    const year = parseInt(date_str.substring(0, 4), 10);
    const month = parseInt(date_str.substring(4, 6), 10) - 1; // Month is 0-indexed in Date
    const day = parseInt(date_str.substring(6, 8), 10);

    if (isNaN(year) || isNaN(month) || isNaN(day)) {
        console.warn(`日期格式錯誤: '${date_str}'。應為YYYYMMDD。`);
        return null;
    }
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

    const TREND_ANALYSIS_TYPES = {
        monthly_total_duration: "每月總收聽時間",
        monthly_top_songs: "每月熱門歌曲",
        monthly_top_artists: "每月熱門歌手",
    };

    if (trend_type_display === TREND_ANALYSIS_TYPES["monthly_total_duration"]) {
        for (const month of sorted_months) {
            const total_ms = monthly_data.get(month).reduce((sum, r) => sum + getMsFromRecord(r.ms_played || 0), 0);
            results.push([month, formatMsToMinSec(total_ms), total_ms]); // (月份, 格式化時長, 原始毫秒)
        }
    } else if (trend_type_display === TREND_ANALYSIS_TYPES["monthly_top_songs"]) {
        const num_top_items = parseInt(numResultsEntryValue, 10) || 5; // Default to 5
        for (const month of sorted_months) {
            const monthly_ranked_songs = rankData(monthly_data.get(month), "master_metadata_track_name", String(num_top_items), "count");
            const top_songs_display = [];
            for (const [item_data, primary_metric, total_ms, count, avg_ms] of monthly_ranked_songs) {
                const [song_name, artist_name] = item_data.split(' - ');
                top_songs_display.push(`${song_name} (${artist_name}) - ${count}次`);
            }
            results.push([month, top_songs_display.join("; ")]);
        }
    } else if (trend_type_display === TREND_ANALYSIS_TYPES["monthly_top_artists"]) {
        const num_top_items = parseInt(numResultsEntryValue, 10) || 5; // Default to 5
        for (const month of sorted_months) {
            const monthly_ranked_artists = rankData(monthly_data.get(month), "master_metadata_album_artist_name", String(num_top_items), "count");
            const top_artists_display = [];
            for (const [item_data, primary_metric, total_ms, count, avg_ms] of monthly_ranked_artists) {
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
    const [filePaths, setFilePaths] = useState([]);
    const [allStreamingDataOriginal, setAllStreamingDataOriginal] = useState([]);
    const [rankedItemsCache, setRankedItemsCache] = useState([]);
    const [currentlyDisplayedRankedItems, setCurrentlyDisplayedRankedItems] = useState([]);
    const [selectedFilesLabel, setSelectedFilesLabel] = useState("尚未選取檔案");
    const [progress, setProgress] = useState(0);
    const [status, setStatus] = useState("準備就緒");

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

    const [isArtistModalOpen, setIsArtistModalOpen] = useState(false);
    const [artistName, setArtistName] = useState("");
    const [artistAlbumsData, setArtistAlbumsData] = useState([]);
    const [artistSongsData, setArtistSongsData] = useState([]);
    const allArtistRecordsFiltered = useRef([]); // To store all filtered records for the artist modal

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

        // Date filtering
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
        if (window.confirm(`您即將前往外部網站：\n\n${url}\n\n是否繼續？`)) {
            window.open(url, '_blank');
            setStatus(`已在瀏覽器中開啟: ${url}`);
        } else {
            setStatus("已取消前往外部連結。");
        }
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


    const showListeningDetails = useCallback((itemIndex) => {
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

        // Handle artist hierarchy
        if (currentFieldToRankKey === "master_metadata_album_artist_name") {
            const artistNameClicked = String(clickedItemData);
            showArtistHierarchyWindow(artistNameClicked);
            return;
        }

        const tempRecordsForDetails = [];
        for (const record of allStreamingDataOriginal) {
            let isMatch = false;
            if (currentFieldToRankKey === "spotify_track_uri") {
                if (record.spotify_track_uri === String(clickedItemData)) {
                    isMatch = true;
                }
            } else if (currentFieldToRankKey === "master_metadata_album_album_name") {
                const [albumToFind, artistToFind] = clickedItemData.split(' - ');
                if (record.master_metadata_album_album_name === albumToFind &&
                    record.master_metadata_album_artist_name === artistToFind) {
                    isMatch = true;
                }
            } else if (currentFieldToRankKey === "master_metadata_track_name" ||
                currentFieldToRankKey === "ms_played") { // if ranking by total duration, still show song details
                if (typeof clickedItemData === 'string' && clickedItemData.includes(' - ')) {
                    const [trackToFind, artistToFind] = clickedItemData.split(' - ');
                    if (record.master_metadata_track_name === trackToFind &&
                        record.master_metadata_album_artist_name === artistToFind) {
                        isMatch = true;
                    }
                } else { // Handle URI case for ms_played ranking
                    if (record.spotify_track_uri === clickedItemData) {
                        isMatch = true;
                    }
                }
            }

            if (isMatch) {
                const recordDateStr = record.ts;
                if (recordDateStr) {
                    try {
                        const recordDate = new Date(recordDateStr.substring(0, 10)); // YYYY-MM-DD
                        const startObj = dateFilterEnabled ? parseDateFromString(startDate) : null;
                        const endObj = dateFilterEnabled ? parseDateFromString(endDate) : null;

                        const start_date_normalized = startObj ? new Date(startObj.getFullYear(), startObj.getMonth(), startObj.getDate()) : null;
                        const end_date_normalized = endObj ? new Date(endObj.getFullYear(), endObj.getMonth(), endObj.getDate()) : null;
                        const item_date_normalized = new Date(recordDate.getFullYear(), recordDate.getMonth(), recordDate.getDate());

                        if ((!start_date_normalized || item_date_normalized >= start_date_normalized) &&
                            (!end_date_normalized || item_date_normalized <= end_date_normalized)) {
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
            }
        } else if (currentFieldToRankKey === "master_metadata_track_name") {
            if (typeof clickedItemData === 'string' && clickedItemData.includes(' - ')) {
                const [songName, artistName] = clickedItemData.split(' - ');
                detailsTitle = `歌曲 '${songName}' (${artistName}) 詳細記錄`;
            }
        } else if (currentFieldToRankKey === "ms_played") {
            if (typeof clickedItemData === 'string' && clickedItemData.includes(' - ')) {
                const [songName, artistName] = clickedItemData.split(' - ');
                detailsTitle = `歌曲 '${songName}' (${artistName}) 詳細記錄`;
            } else {
                detailsTitle = `單曲詳細記錄: ${String(clickedItemData)}`;
            }
        }

        setDetailRecords(tempRecordsForDetails);
        setDetailModalTitle(detailsTitle);
        setDetailMaxPlayTimes(maxPlayTimesForDetails);
        setDetailSearchTerm(""); // Clear search when opening new modal
        setIsDetailModalOpen(true);
    }, [allStreamingDataOriginal, currentlyDisplayedRankedItems, currentFieldToRankKey, dateFilterEnabled, startDate, endDate, trendAnalysisType]);

    const showArtistHierarchyWindow = useCallback((artistNameClicked) => {
        setArtistName(artistNameClicked);
        allArtistRecordsFiltered.current = []; // Clear previous filtered records

        for (const record of allStreamingDataOriginal) {
            if (record.master_metadata_album_artist_name === artistNameClicked) {
                const recordDateStr = record.ts;
                if (recordDateStr) {
                    try {
                        const recordDate = new Date(recordDateStr.substring(0, 10));
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

        setIsArtistModalOpen(true);
    }, [allStreamingDataOriginal, dateFilterEnabled, startDate, endDate]);


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

    const handleArtistSongDoubleClick = useCallback((songNameClicked, albumNameContext) => {
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
    }, [artistName]); // artistName is from the parent modal state


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
                } else if (currentFieldToRankKey === "ms_played") {
                    let itemDisplayName = "";
                    if (typeof item_data === 'string' && item_data.includes(' - ')) {
                        itemDisplayName = item_data;
                    } else {
                        itemDisplayName = String(item_data);
                    }
                    row_data.push(itemDisplayName, formatMsToMinSec(primary_metric_val), count_val, avgDurationStrVal);
                } else { // Single item (platform, country, reason, etc.)
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


    const exportDetailRecordsToCsv = useCallback((recordsToDisplay, title) => {
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

            // For simplicity in web, calculate percentage only if maxPlayTimes is available for that URI
            let play_completion_percentage = "N/A";
            if (detailMaxPlayTimes && uri && detailMaxPlayTimes[uri] > 0) {
                const percentage = (ms_played_int / detailMaxPlayTimes[uri]) * 100;
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
    }, [detailMaxPlayTimes]);


    // Effect to manage main search input state
    useEffect(() => {
        const fieldKey = getFieldKeyFromName(rankingField);
        const shouldEnableSearch = ["master_metadata_track_name", "master_metadata_album_album_name"].includes(fieldKey) && trendAnalysisType === "無";
        setMainSearchEnabled(shouldEnableSearch);
    }, [rankingField, trendAnalysisType, getFieldKeyFromName]);


    // Detail Modal Component
    const DetailModal = ({ isOpen, onClose, records, title, maxPlayTimes, searchTerm, onSearchChange, onSearch, onClearSearch, onExport }) => {
        if (!isOpen) return null;

        const filteredRecords = useMemo(() => {
            if (!searchTerm) return records;
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
        }, [records, searchTerm]);

        const firstRecord = records[0] || {};
        const item_name_for_web_search = firstRecord.master_metadata_track_name || '';
        const artist_name_for_web_search = firstRecord.master_metadata_album_artist_name || '';
        const album_name_for_web_search = firstRecord.master_metadata_album_album_name || '';

        return (
            <div ref={detailModalRef} className="fixed inset-0 bg-gray-600 bg-opacity-50 flex justify-center items-center p-4 z-50">
                <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-5xl max-h-[90vh] flex flex-col">
                    <h2 className="text-xl font-bold mb-4">{title}</h2>

                    <div className="flex items-center space-x-2 mb-4">
                        <label htmlFor="detailSearch" className="text-gray-700">搜尋詳細記錄:</label>
                        <input
                            id="detailSearch"
                            type="text"
                            className="flex-grow p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                            value={searchTerm}
                            onChange={(e) => onSearchChange(e.target.value)}
                        />
                        <button
                            onClick={onSearch}
                            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                        >
                            搜尋
                        </button>
                        <button
                            onClick={onClearSearch}
                            className="px-4 py-2 bg-gray-300 text-gray-800 rounded-md hover:bg-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2"
                        >
                            清除
                        </button>
                        <button
                            onClick={onExport}
                            className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 ml-auto"
                        >
                            匯出詳細記錄為 CSV
                        </button>
                    </div>

                    <div className="flex flex-wrap gap-2 mb-4">
                        {item_name_for_web_search && artist_name_for_web_search && (
                            <button
                                onClick={() => searchLyricsOnline(item_name_for_web_search, artist_name_for_web_search)}
                                className="px-3 py-1 bg-purple-600 text-white text-sm rounded-md hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500"
                            >
                                Google 搜尋歌詞
                            </button>
                        )}
                        {album_name_for_web_search && artist_name_for_web_search && (
                            <button
                                onClick={() => searchAlbumReviewOnline(album_name_for_web_search, artist_name_for_web_search)}
                                className="px-3 py-1 bg-orange-600 text-white text-sm rounded-md hover:bg-orange-700 focus:outline-none focus:ring-2 focus:ring-orange-500"
                            >
                                Google 搜尋專輯評價
                            </button>
                        )}
                    </div>

                    <div className="flex-grow overflow-auto border border-gray-300 rounded-md">
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50 sticky top-0">
                                <tr>
                                    {["播放時間 (UTC)", "播放平台", "播放時長 (分:秒)", "歌曲名稱", "歌手", "專輯名稱",
                                        "播放完整度(%)", "開始原因", "結束原因", "隨機播放", "是否跳過", "離線播放", "隱身模式"].map(header => (
                                            <th key={header} className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                                {header}
                                            </th>
                                        ))}
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {filteredRecords.map((record, index) => {
                                    const ms_played_int = getMsFromRecord(record.ms_played || 0);
                                    const uri = record.spotify_track_uri;
                                    let play_completion_percentage = "N/A";
                                    if (maxPlayTimes && uri && maxPlayTimes[uri] > 0) {
                                        const percentage = (ms_played_int / maxPlayTimes[uri]) * 100;
                                        play_completion_percentage = `${percentage.toFixed(1)}%`;
                                    }

                                    return (
                                        <tr key={index} className="hover:bg-gray-50">
                                            <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-800">{record.ts || 'N/A'}</td>
                                            <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-800">{record.platform || 'N/A'}</td>
                                            <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-800 text-right">{formatMsToMinSec(ms_played_int)}</td>
                                            <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-800">{record.master_metadata_track_name || 'N/A'}</td>
                                            <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-800">{record.master_metadata_album_artist_name || 'N/A'}</td>
                                            <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-800">{record.master_metadata_album_album_name || 'N/A'}</td>
                                            <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-800 text-center">{play_completion_percentage}</td>
                                            <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-800">{record.reason_start || 'N/A'}</td>
                                            <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-800">{record.reason_end || 'N/A'}</td>
                                            <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-800 text-center">{record.shuffle === true ? "是" : (record.shuffle === false ? "否" : "N/A")}</td>
                                            <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-800 text-center">{record.skipped === true ? "是" : (record.skipped === false ? "否" : "N/A")}</td>
                                            <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-800 text-center">{record.offline === true ? "是" : (record.offline === false ? "否" : "N/A")}</td>
                                            <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-800 text-center">{record.incognito_mode === true ? "是" : (record.incognito_mode === false ? "否" : "N/A")}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                    <div className="flex justify-end mt-4">
                        <button
                            onClick={onClose}
                            className="px-6 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
                        >
                            關閉
                        </button>
                    </div>
                </div>
            </div>
        );
    };

    // Artist Modal Component
    const ArtistModal = ({ isOpen, onClose, artistName, albumsData, songsData, onAlbumSelect, onSongDoubleClick, onArtistBioSearch }) => {
        if (!isOpen) return null;

        return (
            <div ref={artistModalRef} className="fixed inset-0 bg-gray-600 bg-opacity-50 flex justify-center items-center p-4 z-50">
                <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-6xl max-h-[90vh] flex flex-col">
                    <h2 className="text-xl font-bold mb-4">歌手詳細資料: {artistName}</h2>

                    <div className="flex justify-center mb-4">
                        <button
                            onClick={() => onArtistBioSearch(artistName)}
                            className="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2"
                        >
                            Google 搜尋藝術家簡介
                        </button>
                    </div>

                    <div className="flex flex-grow overflow-hidden gap-4">
                        {/* Left Pane: Albums */}
                        <div className="w-1/3 flex flex-col border border-gray-300 rounded-md p-2 overflow-auto">
                            <h3 className="text-lg font-semibold mb-2 sticky top-0 bg-white z-10 p-1 -mx-2 -mt-2 border-b">專輯列表</h3>
                            <table className="min-w-full divide-y divide-gray-200">
                                <thead className="bg-gray-50 sticky top-0">
                                    <tr>
                                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">專輯名稱</th>
                                        <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">播放次數</th>
                                        <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">總時長</th>
                                    </tr>
                                </thead>
                                <tbody className="bg-white divide-y divide-gray-200">
                                    {albumsData.map((album, index) => (
                                        <tr key={index} className="hover:bg-gray-50 cursor-pointer" onClick={() => onAlbumSelect(album.albumName)}>
                                            <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-800">{album.albumName}</td>
                                            <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-800 text-right">{album.count}</td>
                                            <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-800 text-right">{album.totalDuration}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        {/* Right Pane: Songs */}
                        <div className="w-2/3 flex flex-col border border-gray-300 rounded-md p-2 overflow-auto">
                            <h3 className="text-lg font-semibold mb-2 sticky top-0 bg-white z-10 p-1 -mx-2 -mt-2 border-b">歌曲列表</h3>
                            <table className="min-w-full divide-y divide-gray-200">
                                <thead className="bg-gray-50 sticky top-0">
                                    <tr>
                                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">歌曲名稱</th>
                                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">所屬專輯</th>
                                        <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">播放次數</th>
                                        <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">總時長</th>
                                    </tr>
                                </thead>
                                <tbody className="bg-white divide-y divide-gray-200">
                                    {songsData.map((song, index) => (
                                        <tr key={index} className="hover:bg-gray-50 cursor-pointer" onDoubleClick={() => onSongDoubleClick(song.songName, song.albumName)}>
                                            <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-800">{song.songName}</td>
                                            <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-800">{song.albumName}</td>
                                            <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-800 text-right">{song.count}</td>
                                            <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-800 text-right">{song.totalDuration}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <div className="flex justify-end mt-4">
                        <button
                            onClick={onClose}
                            className="px-6 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
                        >
                            關閉
                        </button>
                    </div>
                </div>
            </div>
        );
    };


    return (
        <div className="min-h-screen bg-gray-100 p-4 font-inter">
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
                `}
            </style>

            <div className="bg-white p-6 rounded-xl shadow-lg w-full mx-auto">
                <h1 className="text-3xl font-bold text-center text-gray-800 mb-6">Spotify 播放記錄分析器</h1>

                {/* 檔案選取區 */}
                <div className="mb-6 p-4 border border-gray-200 rounded-lg bg-gray-50 shadow-sm">
                    <h2 className="text-xl font-semibold text-gray-700 mb-3">檔案選取</h2>
                    <div className="flex items-center space-x-4">
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
                            className="inline-flex items-center justify-center px-5 py-2 border border-transparent text-base font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 cursor-pointer transition duration-150 ease-in-out shadow-md"
                        >
                            選擇 JSON 檔案
                        </label>
                        <span className="text-gray-600 text-lg">{selectedFilesLabel}</span>
                        <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden ml-auto">
                            <div
                                className="h-full bg-blue-500 rounded-full transition-all duration-300 ease-out"
                                style={{ width: `${progress}%` }}
                            ></div>
                        </div>
                    </div>
                </div>

                {/* 篩選條件區 */}
                <div className="mb-6 p-4 border border-gray-200 rounded-lg bg-gray-50 shadow-sm">
                    <h2 className="text-xl font-semibold text-gray-700 mb-3">篩選與排行條件</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
                        {/* 日期篩選 */}
                        <div className="flex items-center space-x-2">
                            <input
                                type="checkbox"
                                id="dateFilter"
                                checked={dateFilterEnabled}
                                onChange={(e) => setDateFilterEnabled(e.target.checked)}
                                className="form-checkbox h-5 w-5 text-indigo-600 rounded focus:ring-indigo-500"
                            />
                            <label htmlFor="dateFilter" className="text-gray-700 font-medium">依日期篩選?</label>
                            <label htmlFor="startDate" className="text-gray-700">開始日期 (YYYYMMDD):</label>
                            <input
                                type="text"
                                id="startDate"
                                className={`p-2 border rounded-md w-32 ${dateFilterEnabled ? 'border-gray-300' : 'bg-gray-100 border-gray-200 cursor-not-allowed'}`}
                                value={startDate}
                                onChange={(e) => setStartDate(e.target.value)}
                                disabled={!dateFilterEnabled}
                                placeholder="20230101"
                                title="請輸入YYYYMMDD 格式的日期，例如 20230101"
                            />
                            <label htmlFor="endDate" className="text-gray-700">結束日期 (YYYYMMDD):</label>
                            <input
                                type="text"
                                id="endDate"
                                className={`p-2 border rounded-md w-32 ${dateFilterEnabled ? 'border-gray-300' : 'bg-gray-100 border-gray-200 cursor-not-allowed'}`}
                                value={endDate}
                                onChange={(e) => setEndDate(e.target.value)}
                                disabled={!dateFilterEnabled}
                                placeholder="20231231"
                                title="請輸入YYYYMMDD 格式的日期，例如 20231231"
                            />
                        </div>

                        {/* 排行項目與數量 */}
                        <div className="flex items-center space-x-2">
                            <label htmlFor="rankingField" className="text-gray-700">排行項目:</label>
                            <select
                                id="rankingField"
                                value={rankingField}
                                onChange={handleRankingFieldChange}
                                className={`p-2 border rounded-md ${trendAnalysisType !== "無" ? 'bg-gray-100 border-gray-200 cursor-not-allowed' : 'border-gray-300'}`}
                                disabled={trendAnalysisType !== "無"}
                                title="選擇您希望分析的播放記錄類型"
                            >
                                {Object.values(FIELD_MAPPING).map(([key, name]) => (
                                    <option key={key} value={name}>{name}</option>
                                ))}
                            </select>
                            <label htmlFor="numResults" className="text-gray-700">顯示數量:</label>
                            <input
                                type="text"
                                id="numResults"
                                className="p-2 border border-gray-300 rounded-md w-24"
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
                        <div className="flex items-center space-x-3">
                            <span className="text-gray-700">排行標準:</span>
                            <div className="flex space-x-2">
                                <label className="inline-flex items-center">
                                    <input
                                        type="radio"
                                        className="form-radio text-indigo-600 h-4 w-4"
                                        name="rankMetric"
                                        value="count"
                                        checked={rankMetric === "count"}
                                        onChange={(e) => setRankMetric(e.target.value)}
                                        disabled={trendAnalysisType !== "無"}
                                    />
                                    <span className="ml-1 text-gray-700">播放次數</span>
                                </label>
                                <label className="inline-flex items-center">
                                    <input
                                        type="radio"
                                        className="form-radio text-indigo-600 h-4 w-4"
                                        name="rankMetric"
                                        value="duration"
                                        checked={rankMetric === "duration"}
                                        onChange={(e) => setRankMetric(e.target.value)}
                                        disabled={trendAnalysisType !== "無"}
                                    />
                                    <span className="ml-1 text-gray-700">總播放時長</span>
                                </label>
                                <label className="inline-flex items-center">
                                    <input
                                        type="radio"
                                        className="form-radio text-indigo-600 h-4 w-4"
                                        name="rankMetric"
                                        value="avg_duration"
                                        checked={rankMetric === "avg_duration"}
                                        onChange={(e) => setRankMetric(e.target.value)}
                                        disabled={trendAnalysisType !== "無"}
                                    />
                                    <span className="ml-1 text-gray-700">平均播放時長</span>
                                </label>
                            </div>
                        </div>

                        {/* 趨勢分析選項 */}
                        <div className="flex items-center space-x-2">
                            <label htmlFor="trendAnalysis" className="text-gray-700">趨勢分析:</label>
                            <select
                                id="trendAnalysis"
                                value={trendAnalysisType}
                                onChange={handleTrendAnalysisChange}
                                className="p-2 border border-gray-300 rounded-md"
                                title="選擇您希望進行的趨勢分析類型"
                            >
                                {Object.values(TREND_ANALYSIS_TYPES).map((type) => (
                                    <option key={type} value={type}>{type}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    {/* 主結果搜尋框 */}
                    <div className="flex items-center space-x-2 mt-4">
                        <label htmlFor="mainSearch" className="text-gray-700">搜尋結果 (歌曲/專輯):</label>
                        <input
                            type="text"
                            id="mainSearch"
                            className={`flex-grow p-2 border rounded-md ${mainSearchEnabled ? 'border-gray-300' : 'bg-gray-100 border-gray-200 cursor-not-allowed'}`}
                            value={mainSearchTerm}
                            onChange={(e) => setMainSearchTerm(e.target.value)}
                            disabled={!mainSearchEnabled}
                        />
                        <button
                            onClick={filterMainResults}
                            className={`px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${!mainSearchEnabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                            disabled={!mainSearchEnabled}
                        >
                            搜尋
                        </button>
                        <button
                            onClick={clearMainSearch}
                            className={`px-4 py-2 bg-gray-300 text-gray-800 rounded-md hover:bg-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 ${!mainSearchEnabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                            disabled={!mainSearchEnabled}
                        >
                            清除搜尋
                        </button>
                    </div>
                </div>

                {/* 操作按鈕 */}
                <div className="mb-6 flex justify-center space-x-4">
                    <button
                        onClick={analyzeData}
                        className="px-6 py-3 bg-green-600 text-white font-semibold rounded-lg shadow-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 transition duration-150 ease-in-out"
                    >
                        開始分析
                    </button>
                    <button
                        onClick={exportToCsv}
                        className="px-6 py-3 bg-purple-600 text-white font-semibold rounded-lg shadow-md hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 transition duration-150 ease-in-out"
                        disabled={currentlyDisplayedRankedItems.length === 0}
                    >
                        匯出 CSV
                    </button>
                    <button
                        onClick={resetAppState}
                        className="px-6 py-3 bg-red-600 text-white font-semibold rounded-lg shadow-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 transition duration-150 ease-in-out"
                        title="清除所有載入的數據和篩選條件，重設應用程式狀態"
                    >
                        重設
                    </button>
                </div>

                {/* 依賴庫管理區 (說明性質，因為是網頁應用) */}
                <div className="mb-6 p-4 border border-gray-200 rounded-lg bg-gray-50 shadow-sm">
                    <h2 className="text-xl font-semibold text-gray-700 mb-3">依賴庫管理 (網頁相關)</h2>
                    <p className="text-gray-600">
                        這是一個網頁應用程式，不需要像 Python 腳本那樣單獨安裝依賴庫。所有功能都已內建。
                    </p>
                </div>

                {/* 結果顯示區 */}
                <div className="p-4 border border-gray-200 rounded-lg bg-gray-50 shadow-sm flex flex-col min-h-[300px]">
                    <h2 className="text-xl font-semibold text-gray-700 mb-3">分析結果 (雙擊「單曲」、「歌曲名稱-歌手」、「專輯」或「歌手」項目可查看詳細資料)</h2>
                    <div className="flex-grow overflow-auto rounded-md">
                        <table className="treeview-table">
                            <thead>
                                {trendAnalysisType === "無" ? (
                                    <tr>
                                        <th className="w-16">排名</th>
                                        {currentFieldToRankKey === "master_metadata_track_name" && (
                                            <>
                                                <th className="w-64">歌曲名稱</th>
                                                <th className="w-40">歌手</th>
                                            </>
                                        )}
                                        {currentFieldToRankKey === "master_metadata_album_album_name" && (
                                            <>
                                                <th className="w-64">專輯名稱</th>
                                                <th className="w-40">歌手</th>
                                            </>
                                        )}
                                        {currentFieldToRankKey === "spotify_track_uri" && (
                                            <th className="w-80">單曲 (URI)</th>
                                        )}
                                        {currentFieldToRankKey === "master_metadata_album_artist_name" && (
                                            <th className="w-64">歌手</th>
                                        )}
                                        {currentFieldToRankKey === "ms_played" && (
                                            <th className="w-80">歌曲/專輯/URI</th>
                                        )}
                                        {!["master_metadata_track_name", "master_metadata_album_album_name", "spotify_track_uri", "master_metadata_album_artist_name", "ms_played"].includes(currentFieldToRankKey) && (
                                            <th className="w-64">{rankingField.split(" - ")[0]}</th>
                                        )}

                                        {rankMetric === "count" && <th className="w-40 text-right">次數</th>}
                                        {rankMetric === "duration" && <th className="w-40 text-right">總時長</th>}
                                        {rankMetric === "avg_duration" && <th className="w-40 text-right">平均時長</th>}

                                        {(rankMetric !== "duration" || currentFieldToRankKey === "ms_played") && <th className="w-40 text-right">總時長(輔助)</th>}
                                        {(rankMetric !== "avg_duration" || currentFieldToRankKey === "ms_played") && <th className="w-40 text-right">平均時長(輔助)</th>}
                                        {currentFieldToRankKey !== "ms_played" && rankMetric !== "count" && <th className="w-40 text-right">播放次數(輔助)</th>}
                                    </tr>
                                ) : (
                                    <tr>
                                        <th className="w-40">月份</th>
                                        {trendAnalysisType === TREND_ANALYSIS_TYPES.monthly_total_duration && (
                                            <>
                                                <th className="w-64 text-right">總收聽時長</th>
                                            </>
                                        )}
                                        {trendAnalysisType === TREND_ANALYSIS_TYPES.monthly_top_songs && (
                                            <th className="w-full">每月熱門歌曲 (前{parseInt(numResults, 10) || 5}名)</th>
                                        )}
                                        {trendAnalysisType === TREND_ANALYSIS_TYPES.monthly_top_artists && (
                                            <th className="w-full">每月熱門歌手 (前{parseInt(numResults, 10) || 5}名)</th>
                                        )}
                                    </tr>
                                )}
                            </thead>
                            <tbody>
                                {currentlyDisplayedRankedItems.map((item, index) => {
                                    if (trendAnalysisType !== "無") {
                                        return (
                                            <tr key={index} className="hover:bg-gray-50">
                                                <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-800">{item[0]}</td>
                                                <td className="px-4 py-2 whitespace-normal text-sm text-gray-800">
                                                    {trendAnalysisType === TREND_ANALYSIS_TYPES.monthly_total_duration ? item[1] : item[1]}
                                                </td>
                                            </tr>
                                        );
                                    } else {
                                        const [item_data, primary_metric, total_ms, count, avg_ms] = item;
                                        const rankNum = index + 1;

                                        let primaryMetricDisplay = primary_metric;
                                        if (rankMetric === "duration" || rankMetric === "avg_duration") {
                                            primaryMetricDisplay = formatMsToMinSec(primary_metric);
                                        }
                                        const totalDurationStr = formatMsToMinSec(total_ms);
                                        const avgDurationStr = formatMsToMinSec(avg_ms);

                                        let displayCells = [
                                            <td key="rank" className="px-4 py-2 whitespace-nowrap text-sm text-gray-800 text-center">{rankNum}</td>
                                        ];

                                        if (currentFieldToRankKey === "master_metadata_track_name" ||
                                            currentFieldToRankKey === "master_metadata_album_album_name") {
                                            const [name, artist] = item_data.split(' - ');
                                            displayCells.push(
                                                <td key="name" className="px-4 py-2 whitespace-nowrap text-sm text-gray-800">{name}</td>,
                                                <td key="artist" className="px-4 py-2 whitespace-nowrap text-sm text-gray-800">{artist}</td>
                                            );
                                        } else if (currentFieldToRankKey === "spotify_track_uri" || currentFieldToRankKey === "master_metadata_album_artist_name" ||
                                            (!["master_metadata_track_name", "master_metadata_album_album_name", "ms_played"].includes(currentFieldToRankKey))) {
                                            displayCells.push(
                                                <td key="item" className="px-4 py-2 whitespace-nowrap text-sm text-gray-800">{String(item_data)}</td>
                                            );
                                        } else if (currentFieldToRankKey === "ms_played") {
                                            displayCells.push(
                                                <td key="item" className="px-4 py-2 whitespace-nowrap text-sm text-gray-800">{String(item_data)}</td>
                                            );
                                        }

                                        if (currentFieldToRankKey === "ms_played") {
                                            displayCells.push(
                                                <td key="primary_metric" className="px-4 py-2 whitespace-nowrap text-sm text-gray-800 text-right">{formatMsToMinSec(primary_metric)}</td>,
                                                <td key="count_aux" className="px-4 py-2 whitespace-nowrap text-sm text-gray-800 text-right">{count}</td>,
                                                <td key="avg_duration_aux" className="px-4 py-2 whitespace-nowrap text-sm text-gray-800 text-right">{avgDurationStr}</td>
                                            );
                                        } else {
                                            displayCells.push(
                                                <td key="primary_metric" className="px-4 py-2 whitespace-nowrap text-sm text-gray-800 text-right">{primaryMetricDisplay}</td>
                                            );
                                            // Conditional auxiliary columns
                                            if (rankMetric !== "duration") {
                                                displayCells.push(<td key="total_duration_aux" className="px-4 py-2 whitespace-nowrap text-sm text-gray-800 text-right">{totalDurationStr}</td>);
                                            }
                                            if (rankMetric !== "avg_duration") {
                                                displayCells.push(<td key="avg_duration_aux" className="px-4 py-2 whitespace-nowrap text-sm text-gray-800 text-right">{avgDurationStr}</td>);
                                            }
                                            if (rankMetric !== "count") {
                                                displayCells.push(<td key="count_aux" className="px-4 py-2 whitespace-nowrap text-sm text-gray-800 text-right">{count}</td>);
                                            }
                                        }

                                        return (
                                            <tr key={index} className="hover:bg-gray-50 cursor-pointer" onDoubleClick={() => showListeningDetails(index)}>
                                                {displayCells}
                                            </tr>
                                        );
                                    }
                                })}
                                {currentlyDisplayedRankedItems.length === 0 && (
                                    <tr>
                                        <td colSpan="100%" className="px-4 py-4 text-center text-gray-500">
                                            沒有數據可顯示。請選擇 JSON 檔案並點擊「開始分析」。
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                <div className="mt-4 text-center text-gray-600 text-sm">
                    {status}
                </div>
            </div>

            <DetailModal
                isOpen={isDetailModalOpen}
                onClose={() => setIsDetailModalOpen(false)}
                records={detailRecords}
                title={detailModalTitle}
                maxPlayTimes={detailMaxPlayTimes}
                searchTerm={detailSearchTerm}
                onSearchChange={setDetailSearchTerm}
                onSearch={() => {
                    // Re-trigger re-rendering of filteredRecords in DetailModal by changing searchTerm state
                    // The actual filtering logic is inside useMemo in DetailModal
                    setDetailSearchTerm(detailSearchTerm);
                }}
                onClearSearch={() => setDetailSearchTerm("")}
                onExport={() => exportDetailRecordsToCsv(detailRecords, detailModalTitle)}
                searchLyricsOnline={searchLyricsOnline}
                searchAlbumReviewOnline={searchAlbumReviewOnline}
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
            />
        </div>
    );
};

export default App;
