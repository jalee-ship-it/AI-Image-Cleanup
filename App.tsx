
import React, { useState, useCallback, useRef } from 'react';
import { GoogleGenAI, Modality } from "@google/genai";

const UploadIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
    </svg>
);

const Spinner = () => (
    <div className="absolute inset-0 bg-white/80 backdrop-blur-sm flex items-center justify-center rounded-lg z-10">
        <div className="flex flex-col items-center justify-center gap-4">
            <div className="w-12 h-12 rounded-full animate-spin border-4 border-dashed border-blue-600 border-t-transparent"></div>
            <p className="text-gray-600">AI가 이미지를 수정하고 있습니다...</p>
        </div>
    </div>
);

const PROMPTS = {
    REMOVE_BLEMISHES: `**역할**: 당신은 최고의 정밀 이미지 복원 AI입니다. 당신의 유일한 임무는 원본의 모든 특성을 100% 보존하면서 오직 미세한 결함만을 제거하는 것입니다.

**수행 작업**: 이미지 속 피사체 표면의 '미세한 스크래치, 먼지, 작은 얼룩'과 같은 결함을 완벽하게 제거해주세요.

**절대 규칙 (반드시 지켜야 할 원칙):**

1.  **결함만 제거**: 지정된 결함 외에는 이미지의 어떤 부분도 수정해서는 안 됩니다.
2.  **원본 형태 및 질감 완벽 보존**:
    *   피사체의 외곽선, 형태, 구조를 절대 변경하지 마세요.
    *   표면의 고유한 질감(texture)이나 재질감을 그대로 유지해야 합니다. 질감을 흐리게 만들거나 인위적으로 매끄럽게 만들지 마세요.
3.  **색상 및 조명 일관성 유지**:
    *   제품의 원래 색상을 정확히 유지해야 합니다. 색조, 채도, 밝기가 조금이라도 변해서는 안 됩니다.
    *   원본의 빛 반사, 그림자, 하이라이트 등 모든 조명 효과를 그대로 보존해야 합니다.
4.  **완벽한 자연스러움**: 수정된 부분은 주변과 구별할 수 없을 정도로 자연스러워야 합니다. 어떠한 인위적인 흔적이나 편집의 경계도 남기지 마세요.

**최종 결과물 요건**: 원본 이미지에서 오직 '먼지와 스크래치'만 사라진, 형태, 질감, 색상, 조명이 완벽히 동일한 이미지를 생성해야 합니다.`,
    REMOVE_BACKGROUND_MAGENTA: `**ROLE: You are an expert image editing AI.**
    
**PRIMARY DIRECTIVE: Perfectly isolate the main subject(s) from the background. The subject must remain completely unchanged.**

**OUTPUT SPECIFICATIONS:**
1.  **Subject Preservation:** The main subject(s) of the image must be preserved with 100% accuracy. Do not alter their shape, color, texture, or any details.
2.  **Background Replacement:** The entire background must be replaced with a solid, pure magenta color. The exact hex code for this color is #FF00FF.
3.  **Edge Quality:** The border between the subject and the new magenta background must be sharp and clean. Avoid blurry, feathered, or anti-aliased edges. The transition should be precise.
4.  **No Other Colors in Background:** The background must ONLY contain the color #FF00FF.

**TASK: Identify the primary subject(s), preserve them perfectly, and replace the entire background with solid magenta (#FF00FF).**`
};

// Helper to convert RGB to HSL, which is better for identifying a specific color hue
const rgbToHsl = (r: number, g: number, b: number): [number, number, number] => {
    r /= 255;
    g /= 255;
    b /= 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h = 0, s = 0, l = (max + min) / 2;

    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
        }
        h /= 6;
    }

    return [h * 360, s, l];
};


export default function App() {
    const [originalFile, setOriginalFile] = useState<File | null>(null);
    const [history, setHistory] = useState<string[]>([]);
    const [historyIndex, setHistoryIndex] = useState<number>(-1);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const [isDragging, setIsDragging] = useState<boolean>(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const currentImageSrc = history[historyIndex] ?? null;

    const makeMagentaTransparent = (sourceImageSrc: string): Promise<string> => {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'Anonymous';
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    return reject(new Error("Could not get canvas context"));
                }
                canvas.width = img.width;
                canvas.height = img.height;
                ctx.drawImage(img, 0, 0);

                const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                const data = imageData.data;
                const magentaHue = 300;
                const hueTolerance = 25; // More robust range for AI variations (275-325)
                const minSaturation = 0.25; // Must be reasonably saturated
                const minLightness = 0.15;  // Not too dark
                const maxLightness = 0.95;  // Not too light

                for (let i = 0; i < data.length; i += 4) {
                    const r = data[i];
                    const g = data[i + 1];
                    const b = data[i + 2];

                    const [h, s, l] = rgbToHsl(r, g, b);

                    // Calculate the shortest distance on the color wheel
                    const hueDiff = Math.abs(h - magentaHue);
                    const hueDistance = Math.min(hueDiff, 360 - hueDiff);

                    if (
                        hueDistance <= hueTolerance &&
                        s >= minSaturation &&
                        l >= minLightness &&
                        l <= maxLightness
                    ) {
                        data[i + 3] = 0; // Set alpha to transparent
                    }
                }

                ctx.putImageData(imageData, 0, 0);
                resolve(canvas.toDataURL('image/png'));
            };
            img.onerror = (err) => reject(new Error(`Failed to load image for magenta removal: ${err}`));
            img.src = sourceImageSrc;
        });
    };

    const processFile = (file: File) => {
        if (file && file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onload = (e) => {
                const base64String = e.target?.result as string;
                if (base64String) {
                    handleReset();
                    setOriginalFile(file);
                    setHistory([base64String]);
                    setHistoryIndex(0);
                    setError(null);
                } else {
                    setError("Could not read the uploaded file.");
                }
            };
            reader.onerror = () => {
                setError("Failed to read the image file.");
            };
            reader.readAsDataURL(file);
        } else {
            setError("Please upload a valid image file (PNG, JPG, etc.).");
        }
    };

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file) {
            processFile(file);
        }
    };
    
    const handleDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        setIsDragging(true);
    }, []);

    const handleDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        setIsDragging(false);
    }, []);

    const handleDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        setIsDragging(false);
        const file = event.dataTransfer.files?.[0];
        if (file) {
            processFile(file);
        }
    }, []);

    const handleGenerate = useCallback(async (prompt: string, actionName: string) => {
        const currentImage = history[historyIndex];
        if (!currentImage) {
            setError("Please upload an image first.");
            return;
        }

        setIsLoading(true);
        setError(null);

        try {
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
            
            const [header, data] = currentImage.split(',');
            const mimeType = header.match(/:(.*?);/)?.[1] || 'image/png';
            const imagePart = { inlineData: { data, mimeType } };

            const isBgRemoval = actionName === "배경 제거";
            const finalPrompt = isBgRemoval ? PROMPTS.REMOVE_BACKGROUND_MAGENTA : prompt;

            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash-image',
                contents: [{
                    parts: [
                        imagePart,
                        { text: finalPrompt },
                    ],
                }],
                config: {
                    responseModalities: [Modality.IMAGE],
                },
            });
            
            const imagePartFound = response.candidates?.[0]?.content?.parts?.find(p => p.inlineData);

            if (imagePartFound && imagePartFound.inlineData) {
                const base64ImageBytes: string = imagePartFound.inlineData.data;
                const resMimeType = imagePartFound.inlineData.mimeType;
                const aiResultImageSrc = `data:${resMimeType};base64,${base64ImageBytes}`;
                
                let finalImageSrc = aiResultImageSrc;

                if (isBgRemoval) {
                    finalImageSrc = await makeMagentaTransparent(aiResultImageSrc);
                }
                
                const newHistory = history.slice(0, historyIndex + 1);
                newHistory.push(finalImageSrc);
                setHistory(newHistory);
                setHistoryIndex(newHistory.length - 1);

            } else {
                console.error("AI response did not contain a valid image part:", response);
                throw new Error("AI did not return a valid image. Please try again.");
            }

        } catch (e) {
            console.error(e);
            const errorMessage = e instanceof Error ? e.message : "An unknown error occurred.";
            setError(`작업에 실패했습니다: ${errorMessage}`);
        } finally {
            setIsLoading(false);
        }
    }, [history, historyIndex]);
    
    const handleReset = () => {
        setOriginalFile(null);
        setHistory([]);
        setHistoryIndex(-1);
        setError(null);
        if(fileInputRef.current) {
            fileInputRef.current.value = "";
        }
    };
    
    const handleUndo = () => {
        if (historyIndex > 0) {
            setHistoryIndex(historyIndex - 1);
        }
    };

    const handleRedo = () => {
        if (historyIndex < history.length - 1) {
            setHistoryIndex(historyIndex + 1);
        }
    };
    
    const isUndoable = historyIndex > 0;
    const isRedoable = historyIndex < history.length - 1;
    const canDownload = historyIndex > 0;


    return (
        <div className="min-h-screen flex items-center justify-center p-4 font-sans text-gray-800">
            <main className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-6xl">
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                    {/* Image Panel */}
                    <div className="lg:col-span-8">
                        <div className="relative aspect-[4/3] bg-gray-50 rounded-lg border border-gray-200 flex items-center justify-center p-2">
                             {isLoading && <Spinner />}
                            {currentImageSrc ? (
                                <img src={currentImageSrc} alt="Displayed" className="max-w-full max-h-full object-contain rounded-md" />
                            ) : (
                                <div 
                                    className={`w-full h-full border-2 border-dashed rounded-lg flex flex-col items-center justify-center text-center cursor-pointer transition-colors ${
                                        isDragging 
                                            ? 'border-blue-500 bg-blue-50' 
                                            : 'border-gray-300 hover:border-blue-400 hover:bg-gray-100'
                                    }`}
                                    onClick={() => fileInputRef.current?.click()}
                                    onDragOver={handleDragOver}
                                    onDragLeave={handleDragLeave}
                                    onDrop={handleDrop}
                                >
                                    <UploadIcon />
                                    <p className="mt-2 font-semibold">클릭하여 업로드하거나 드래그 앤 드롭하세요</p>
                                    <p className="text-xs text-gray-500 mt-1">PNG, JPG, WEBP 등</p>
                                </div>
                            )}
                            <input
                                type="file"
                                ref={fileInputRef}
                                onChange={handleFileChange}
                                accept="image/*"
                                className="hidden"
                            />
                        </div>
                    </div>
                    
                    {/* Controls Panel */}
                    <aside className="lg:col-span-4 flex flex-col justify-between">
                        <div className="flex flex-col gap-4">
                             <h2 className="text-xl font-bold text-black border-b pb-2 mb-2">이미지 보정</h2>
                             <button
                                onClick={() => handleGenerate(PROMPTS.REMOVE_BACKGROUND_MAGENTA, "배경 제거")}
                                disabled={!currentImageSrc || isLoading}
                                className="w-full text-left p-3 bg-white border border-gray-300 rounded-lg hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
                            >
                                배경 제거
                            </button>
                             <button
                                onClick={() => handleGenerate(PROMPTS.REMOVE_BLEMISHES, "먼지 제거")}
                                disabled={!currentImageSrc || isLoading}
                                className="w-full text-left p-3 bg-white border border-gray-300 rounded-lg hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
                            >
                                먼지 제거
                            </button>
                        </div>
                        
                        <div className="flex flex-col gap-3 mt-8">
                            <div className="grid grid-cols-2 gap-3">
                                <button
                                    onClick={handleUndo}
                                    disabled={!isUndoable || isLoading}
                                    className="w-full p-2 bg-white border border-gray-300 rounded-md hover:bg-gray-100 disabled:opacity-50 transition-colors text-sm"
                                >
                                    이전
                                </button>
                                <button
                                    onClick={handleRedo}
                                    disabled={!isRedoable || isLoading}
                                    className="w-full p-2 bg-white border border-gray-300 rounded-md hover:bg-gray-100 disabled:opacity-50 transition-colors text-sm"
                                >
                                    다시 실행
                                </button>
                            </div>

                             <a
                                href={currentImageSrc ?? '#'}
                                download="edited-image.png"
                                className={`w-full p-3 text-center rounded-lg transition-colors ${
                                    canDownload && !isLoading
                                        ? 'bg-blue-600 text-white hover:bg-blue-700'
                                        : 'bg-blue-300 text-white cursor-not-allowed'
                                }`}
                                onClick={(e) => (!canDownload || isLoading) && e.preventDefault()}
                                aria-disabled={!canDownload || isLoading}
                            >
                                다운로드
                            </a>
                             <button
                                onClick={handleReset}
                                disabled={isLoading}
                                className="w-full p-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 disabled:opacity-50 transition-colors text-sm"
                            >
                                초기화
                            </button>
                        </div>
                    </aside>
                </div>
                 {error && (
                    <div className="mt-4 text-center text-red-600 bg-red-100 p-3 rounded-lg text-sm">
                        <p>{error}</p>
                    </div>
                )}
            </main>
        </div>
    );
}
