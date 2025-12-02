document.addEventListener("DOMContentLoaded", function() {
    let map;
    let markers = [];       // 마커 배열
    let userMarker = null;  // 내 위치 마커
    let ps;
    let selectedMarkerIndex = -1;

    // --- [이미지 주소 정의] ---
    const IMG_BLUE = "https://t1.daumcdn.net/mapjsapi/images/marker.png"; // 병원 (기본 파랑) //기존 병원 파랑에서 응급실 마커로 동일하게 변경.
    // 약국용 (노란색 별 마커)
    const IMG_STAR = "https://t1.daumcdn.net/localimg/localimages/07/mapapidoc/markerStar.png"; 
    
    const IMG_USER = "https://t1.daumcdn.net/localimg/localimages/07/2018/pc/img/marker_spot.png"; // 내 위치
    
    // 응급실용 마커
    const IMG_GREEN_PIN = "http://maps.google.com/mapfiles/ms/icons/green-dot.png";
    const IMG_GREY_PIN = "http://maps.google.com/mapfiles/ms/icons/red-dot.png"; 
    const IMG_RED = "https://t1.daumcdn.net/localimg/localimages/07/mapapidoc/marker_red.png"; // 선택됨

    // 1. 지도 초기화
    const container = document.getElementById("map");
    kakao.maps.load(() => {
        const options = { center: new kakao.maps.LatLng(37.5665, 126.9780), level: 5 };
        map = new kakao.maps.Map(container, options);
        ps = new kakao.maps.services.Places();
    });

    // 2. 버튼 이벤트 리스너 연결 (수정됨)
    const btn = document.getElementById("myLocationBtn");
    if (btn) btn.addEventListener("click", () => {
        handleSearch('hospital');
        setActiveButton('myLocationBtn'); // 버튼 색상 변경
    });

    const erBtn = document.getElementById("emergencyBtn");
    if (erBtn) erBtn.addEventListener("click", () => {
        handleSearch('emergency');
        setActiveButton('emergencyBtn'); // 버튼 색상 변경
    });

    const pharmBtn = document.getElementById("pharmacyBtn");
    if (pharmBtn) pharmBtn.addEventListener("click", () => {
        handleSearch('pharmacy');
        setActiveButton('pharmacyBtn'); // 버튼 색상 변경
    });

    // [추가] 버튼 활성화 스타일 적용 함수
    function setActiveButton(activeId) {
        const ids = ["myLocationBtn", "emergencyBtn", "pharmacyBtn"];
        
        ids.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                if (id === activeId) {
                    el.classList.add("active"); // 선택된 버튼에 active 클래스 추가
                } else {
                    el.classList.remove("active"); // 나머지는 제거
                }
            }
        });
    }

    // --- [공통 검색 핸들러] ---
    function handleSearch(type) {
        let radius = document.getElementById("radiusSelect").value;
        let keyword = document.getElementById("keywordInput").value.trim();
        
        const statusMsg = document.getElementById("status-msg");
        statusMsg.style.display = "block";

        // 메시지 및 상태 설정
        if (type === 'pharmacy') {
            statusMsg.innerText = "💊 주변 실시간 약국 찾는 중...";
            // 약국은 키워드가 없어도 API에서 위치 기반으로 찾음
        } else if (type === 'hospital') {
            statusMsg.innerText = "🏥 병원 조회 중...";
        } else {
            statusMsg.innerText = "🚨 실시간 병상 조회 중...";
        }

        if (!navigator.geolocation) return alert("위치 정보를 사용할 수 없습니다.");

        navigator.geolocation.getCurrentPosition(async (position) => {
            const lat = position.coords.latitude;
            const lon = position.coords.longitude;
            
            if (map) {
                const myPos = new kakao.maps.LatLng(lat, lon);
                map.setCenter(myPos);
                
                // 줌 레벨 조정 (응급실은 넓게, 나머지는 상세하게)
                const zoomLevel = (type === 'emergency') ? 7 : 4;
                map.setLevel(zoomLevel);
                
                if (userMarker) userMarker.setMap(null);
                const userSize = new kakao.maps.Size(30, 40);
                const userImg = new kakao.maps.MarkerImage(IMG_USER, userSize); 
                userMarker = new kakao.maps.Marker({ 
                    position: myPos, map: map, title: "내 위치", image: userImg, zIndex: 3 
                });
            }

            // 타입별 데이터 로드 분기
            if (type === 'emergency') {
                await loadEmergency(lat, lon);
                setActiveButton("emergencyBtn");
            } else if (type === 'pharmacy') {
                // [NEW] 약국 전용 API 호출
                await loadPharmacies(lat, lon);
            } else {
                // 일반 병원 호출
                await loadHospitals(lat, lon, keyword, radius);
                setActiveButton("myLocationBtn");
            }
            
            statusMsg.innerText = "✅ 완료!";
            
        }, (err) => {
            console.error(err);
            statusMsg.innerText = "위치 확보 실패";
        });
    }

    // --- [데이터 로드 함수들] ---

    // 1. 일반 병원 데이터 로드
    async function loadHospitals(lat, lon, keyword, radius) {
        try {
            const url = `/api/hospitals?lat=${lat}&lon=${lon}&keyword=${keyword}&radius=${radius}`;
            const res = await fetch(url);
            const data = await res.json();

            if (!data || data.length === 0) {
                alert("주변에 병원 검색 결과가 없습니다.");
                return;
            }
            
            renderMarkers(data, 'hospital');
            renderList(data, 'hospital');

            setActiveButton("myLocationBtn");
        } catch (error) {
            console.error(error);
            alert("병원 데이터 서버 오류");
        }
    }

    // 2. [NEW] 약국 데이터 로드
    async function loadPharmacies(lat, lon) {
        // 반경 선택값 가져오기
        const radius = document.getElementById("radiusSelect").value;

        try {
            const url = `/api/pharmacy?lat=${lat}&lon=${lon}&radius=${radius}`;
            
            const res = await fetch(url);
            
            // [중요] 이 줄이 없으면 'data is not defined' 오류가 납니다!
            const data = await res.json(); 

            // 데이터가 없거나 비어있을 때 처리
            if (!data || data.length === 0) {
                alert(`주변 ${radius}km 이내에 약국 검색 결과가 없습니다.`);
                return;
            }

            renderMarkers(data, 'pharmacy'); 
            renderList(data, 'pharmacy');
        } catch (error) {
            console.error(error);
            alert("약국 데이터 서버 오류");
        }
    }

    // 3. 실시간 응급실 데이터 로드
    async function loadEmergency(lat, lon) {
        try {
            const url = `/api/emergency?lat=${lat}&lon=${lon}`;
            const res = await fetch(url);
            const data = await res.json();

            if (data.error) {
                alert("API 오류: " + data.error);
                return;
            }
            if (!data || data.length === 0) {
                alert("주변에 응급실 데이터가 없습니다.");
                return;
            }

            renderEmergencyMarkers(data);
            renderEmergencyList(data);

        } catch (error) {
            console.error(error);
            alert("응급실 데이터 통신 실패");
        }
    }

    // --- [렌더링 함수들] ---

    // A. 일반 병원 & 약국 마커 렌더링
    function renderMarkers(list, type) {
        removeMarkers();
        selectedMarkerIndex = -1;
        const size = new kakao.maps.Size(24, 35);
        
        // 타입에 따라 이미지 선택 (약국이면 별모양, 병원이면 파랑)
        const imgSrc = (type === 'pharmacy') ? IMG_STAR : IMG_BLUE;
        const markerImg = new kakao.maps.MarkerImage(IMG_GREEN_PIN, size);

        list.forEach((item, index) => {
            const marker = new kakao.maps.Marker({
                position: new kakao.maps.LatLng(item.lat, item.lng),
                map: map,
                title: item.name,
                image: markerImg,
                zIndex: 1
            });
            
            // 원래 이미지 저장 (선택 해제 시 복구용)
            marker.normalImage = markerImg;

            kakao.maps.event.addListener(marker, 'click', function() {
                selectLocation(index, item.lat, item.lng);
            });
            markers.push(marker);
        });
    }

    // B. 응급실 마커 렌더링
    function renderEmergencyMarkers(list) {
        removeMarkers();
        selectedMarkerIndex = -1;

        list.forEach((item, index) => {
            const isAvailable = item.available > 0;
            const pinImg = isAvailable ? IMG_GREEN_PIN : IMG_GREY_PIN;
            const size = new kakao.maps.Size(32, 32);
            const markerImg = new kakao.maps.MarkerImage(pinImg, size);

            const marker = new kakao.maps.Marker({
                position: new kakao.maps.LatLng(item.lat, item.lng),
                map: map,
                title: `${item.name} (${item.available})`,
                image: markerImg,
                zIndex: 2
            });

            marker.normalImage = markerImg;

            kakao.maps.event.addListener(marker, 'click', function() {
                selectLocation(index, item.lat, item.lng, true); 
            });

            markers.push(marker);
        });
    }

    // C. 통합 선택 함수
    function selectLocation(index, lat, lng, isEmergency = false) {
        const selectedSize = new kakao.maps.Size(40, 55);
        const selectedImg = new kakao.maps.MarkerImage(IMG_RED, selectedSize);

        // 이전 선택 복구
        if (selectedMarkerIndex !== -1 && markers[selectedMarkerIndex]) {
            const prevMarker = markers[selectedMarkerIndex];
            prevMarker.setImage(prevMarker.normalImage);
            prevMarker.setZIndex(1);
            
            const prevItem = document.getElementById(`item-${selectedMarkerIndex}`);
            if (prevItem) prevItem.classList.remove("active");
        }

        // 새 선택 강조
        if (markers[index]) {
            markers[index].setImage(selectedImg);
            markers[index].setZIndex(3);
            map.panTo(new kakao.maps.LatLng(lat, lng));

            const currItem = document.getElementById(`item-${index}`);
            if (currItem) {
                currItem.classList.add("active");
                currItem.scrollIntoView({ behavior: "smooth", block: "center" });
            }
            selectedMarkerIndex = index;
        }
    }

    // D. 병원 및 약국 리스트 렌더링 (통합)
    function renderList(list, type) {
        const listDiv = document.getElementById("hospital-list");
        listDiv.innerHTML = "";

        list.forEach((h, index) => {
            const item = document.createElement("div");
            item.className = "hospital-item"; 
            item.id = `item-${index}`; 
            
            // 아이콘 및 상태 뱃지 결정
            let icon = "🏥";
            let statusBadge = "";

            if (type === 'pharmacy') {
                icon = "💊";
                // 약국은 영업 상태(status)가 있음
                if (h.status === "영업중") {
                    statusBadge = `<span style="color:#2E7D32; font-weight:bold; font-size:0.8em; margin-left:5px;">[영업중]</span>`;
                } else if (h.status === "영업종료") {
                    statusBadge = `<span style="color:#D32F2F; font-weight:bold; font-size:0.8em; margin-left:5px;">[영업종료]</span>`;
                } else {
                    statusBadge = `<span style="color:#757575; font-size:0.8em; margin-left:5px;">[${h.status || '확인불가'}]</span>`;
                }
            }

            item.innerHTML = `
                <div style="font-weight:bold; font-size:1.1em; margin-bottom:5px;">
                    ${icon} ${h.name} ${statusBadge}
                </div>
                <div style="font-size:0.9em; color:#666;">${h.address || "주소 정보 없음"}</div>
                <div style="font-size:0.8em; color:#888; margin:5px 0;">
                    ${h.phone || "-"} | <span style="color:#d9534f; font-weight:bold;">${h.distance}km</span>
                </div>
                <button class="detail-btn" style="width:100%; margin-top:5px; background:#FAE100; color:#3b1e1e; border:none; padding:8px; border-radius:4px; font-weight:bold; cursor:pointer;">
                    카카오맵 상세정보 >
                </button>
            `;
            
            item.onclick = (e) => {
                if (e.target.tagName === 'BUTTON') return;
                selectLocation(index, h.lat, h.lng);
            };
            item.querySelector(".detail-btn").onclick = () => {
                findAndOpenDetail(h.name, h.lat, h.lng);
            };
            listDiv.appendChild(item);
        });
    }

    // E. 응급실 리스트 렌더링
    function renderEmergencyList(list) {
        const listDiv = document.getElementById("hospital-list");
        listDiv.innerHTML = "";

        list.forEach((h, index) => {
            const item = document.createElement("div");
            item.className = "hospital-item";
            item.id = `item-${index}`;
            
            const statusColor = h.available > 0 ? "#2E7D32" : "#D32F2F";
            const statusText = h.available > 0 ? `🟢 가능 (${h.available}석)` : "🔴 불가 (만실)";

            item.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <div style="font-weight:bold; font-size:1.1em;">🚨 ${h.name}</div>
                    <div style="font-weight:bold; color:${statusColor}; font-size:0.95em;">${statusText}</div>
                </div>
                <div style="font-size:0.9em; color:#666; margin-top:5px;">${h.address}</div>
                <div style="font-size:0.85em; margin-top:5px;">
                    거리: <strong>${h.distance}km</strong>
                </div>
                <div style="margin-top:10px; font-size:0.9em;">
                    <a href="tel:${h.phone}" style="text-decoration:none; color:#333; background:#eee; padding:5px 10px; border-radius:5px;">
                        📞 전화 걸기 (${h.phone})
                    </a>
                </div>
            `;
            item.onclick = () => selectLocation(index, h.lat, h.lng, true);
            listDiv.appendChild(item);
        });
    }

    function removeMarkers() {
        for (let i = 0; i < markers.length; i++) {
            markers[i].setMap(null);
        }
        markers = [];
    }
    
    function findAndOpenDetail(name, lat, lng) {
        if (!ps) return;
        const options = { location: new kakao.maps.LatLng(lat, lng), radius: 50 };
        ps.keywordSearch(name, (data, status) => {
            if (status === kakao.maps.services.Status.OK) {
                window.open(`https://place.map.kakao.com/${data[0].id}`, '_blank');
            } else {
                window.open(`https://map.kakao.com/link/search/${name}`, '_blank');
            }
        }, options);
    }
});