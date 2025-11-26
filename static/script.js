document.addEventListener("DOMContentLoaded", function() {
    let map;
    let markers = [];       // 마커 배열
    let userMarker = null;  // 내 위치 마커
    let ps;
    let selectedMarkerIndex = -1;

    // --- [이미지 주소 정의] ---
    const IMG_BLUE = "https://t1.daumcdn.net/mapjsapi/images/marker.png"; // 병원 (기본 파랑)
    const IMG_ORANGE = "http://t1.daumcdn.net/localimg/localimages/07/mapapidoc/markerStar.png"; // 약국 (별모양 or 주황색 대체)
    // 혹은 카카오에서 제공하는 다른 마커 이미지를 써도 됩니다. 여기서는 구분을 위해 Star 사용
    
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

    // 2. [일반 병원 찾기] 버튼
    const btn = document.getElementById("myLocationBtn");
    if (btn) {
        btn.addEventListener("click", () => handleSearch('hospital'));
    }

    // 3. [응급실 찾기] 버튼
    const erBtn = document.getElementById("emergencyBtn");
    if (erBtn) {
        erBtn.addEventListener("click", () => handleSearch('emergency'));
    }

    // 4. [NEW] [약국 찾기] 버튼
    const pharmBtn = document.getElementById("pharmacyBtn");
    if (pharmBtn) {
        pharmBtn.addEventListener("click", () => handleSearch('pharmacy'));
    }

    // --- [공통 검색 핸들러] ---
    function handleSearch(type) {
        let radius = document.getElementById("radiusSelect").value;
        let keyword = document.getElementById("keywordInput").value.trim();
        
        const statusMsg = document.getElementById("status-msg");
        statusMsg.style.display = "block";

        // [중요] 약국 찾기 모드일 경우 키워드 강제 설정
        if (type === 'pharmacy') {
            keyword = "약국";
            statusMsg.innerText = "💊 주변 약국 찾는 중...";
            // 약국은 가까운 곳을 찾으므로 반경을 따로 설정하고 싶다면 아래 주석 해제
            // radius = 1; 
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
                
                // 줌 레벨 조정 (응급실은 넓게, 약국/병원은 좁게)
                const zoomLevel = (type === 'emergency') ? 7 : 4;
                map.setLevel(zoomLevel);
                
                if (userMarker) userMarker.setMap(null);
                const userSize = new kakao.maps.Size(30, 40);
                const userImg = new kakao.maps.MarkerImage(IMG_USER, userSize); 
                userMarker = new kakao.maps.Marker({ 
                    position: myPos, map: map, title: "내 위치", image: userImg, zIndex: 3 
                });
            }

            if (type === 'emergency') {
                await loadEmergency(lat, lon);
            } else {
                // 병원과 약국은 같은 API를 사용하되 키워드만 다름
                // renderType을 전달하여 마커 색상을 결정
                await loadHospitals(lat, lon, keyword, radius, type);
            }
            
            statusMsg.innerText = "✅ 완료!";
            
        }, (err) => {
            console.error(err);
            statusMsg.innerText = "위치 확보 실패";
        });
    }

    // --- [데이터 로드 함수들] ---

    // 일반 병원 & 약국 데이터 로드
    async function loadHospitals(lat, lon, keyword, radius, type) {
        try {
            // 키워드가 없으면 전체 검색이 되므로, 약국일 땐 필히 "약국"이 들어가야 함
            const url = `http://127.0.0.1:5000/api/hospitals?lat=${lat}&lon=${lon}&keyword=${keyword}&radius=${radius}`;
            const res = await fetch(url);
            const data = await res.json();

            if (data.length === 0) {
                alert((type === 'pharmacy' ? "약국" : "병원") + " 검색 결과가 없습니다.");
                return;
            }
            // type 정보를 넘겨서 마커 색상을 결정
            renderMarkers(data, type);
            renderHospitalList(data);
        } catch (error) {
            console.error(error);
            alert("서버 오류");
        }
    }

    // 실시간 응급실 데이터 로드
    async function loadEmergency(lat, lon) {
        try {
            const url = `http://127.0.0.1:5000/api/emergency?lat=${lat}&lon=${lon}`;
            const res = await fetch(url);
            const data = await res.json();

            if (data.error) {
                alert("API 오류: " + data.error);
                return;
            }
            if (data.length === 0) {
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

    // 일반/약국 마커 렌더링
    function renderMarkers(list, type) {
        removeMarkers();
        selectedMarkerIndex = -1;
        const size = new kakao.maps.Size(24, 35);
        
        // 타입에 따라 이미지 선택 (약국이면 주황/별, 병원이면 파랑)
        const imgSrc = (type === 'pharmacy') ? IMG_ORANGE : IMG_BLUE;
        const markerImg = new kakao.maps.MarkerImage(imgSrc, size);

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

    // 응급실 마커 렌더링
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
                selectLocation(index, item.lat, item.lng, true); // true = 응급실
            });

            markers.push(marker);
        });
    }

    // 통합 선택 함수 (병원/약국/응급실 공용)
    function selectLocation(index, lat, lng, isEmergency = false) {
        const selectedSize = new kakao.maps.Size(40, 55);
        const selectedImg = new kakao.maps.MarkerImage(IMG_RED, selectedSize);

        // 이전 선택 복구
        if (selectedMarkerIndex !== -1 && markers[selectedMarkerIndex]) {
            const prevMarker = markers[selectedMarkerIndex];
            prevMarker.setImage(prevMarker.normalImage); // 원래 저장해둔 이미지로 복구
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

    // 병원/약국 리스트 렌더링
    function renderHospitalList(list) {
        const listDiv = document.getElementById("hospital-list");
        listDiv.innerHTML = "";

        list.forEach((h, index) => {
            const item = document.createElement("div");
            item.className = "hospital-item"; 
            item.id = `item-${index}`; 
            
            // 이름 앞에 약국 아이콘 표시
            const icon = h.type === 'pharmacy' ? "💊" : "🏥";

            item.innerHTML = `
                <div style="font-weight:bold; font-size:1.1em; margin-bottom:5px;">${icon} ${h.name}</div>
                <div style="font-size:0.9em; color:#666;">${h.address}</div>
                <div style="font-size:0.8em; color:#888; margin:5px 0;">
                    ${h.phone || "-"} | <span style="color:#d9534f; font-weight:bold;">${h.distance}km</span>
                </div>
                <button class="detail-btn" style="width:100%; margin-top:5px; background:#FAE100; color:#3b1e1e; border:none; padding:8px; border-radius:4px; font-weight:bold; cursor:pointer;">카카오맵 상세정보 ></button>
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

    // 응급실 리스트 렌더링 (기존 로직 유지)
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