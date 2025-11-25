document.addEventListener("DOMContentLoaded", function() {
    let map;
    let markers = [];       // 마커 배열
    let userMarker = null;  // 내 위치 마커
    let ps;
    let selectedMarkerIndex = -1;

    // 이미지 주소
    const IMG_BLUE = "https://t1.daumcdn.net/mapjsapi/images/marker.png";
    const IMG_RED = "https://t1.daumcdn.net/localimg/localimages/07/mapapidoc/marker_red.png";
    const IMG_USER = "https://t1.daumcdn.net/localimg/localimages/07/mapapidoc/markerStar.png"; 
    
    // 응급실용 마커 (구글 핀 사용)
    const IMG_GREEN_PIN = "http://maps.google.com/mapfiles/ms/icons/green-dot.png";
    const IMG_GREY_PIN = "http://maps.google.com/mapfiles/ms/icons/red-dot.png"; 

    // 1. 지도 초기화
    const container = document.getElementById("map");
    kakao.maps.load(() => {
        const options = { center: new kakao.maps.LatLng(37.5665, 126.9780), level: 5 };
        map = new kakao.maps.Map(container, options);
        ps = new kakao.maps.services.Places();
    });

    // 2. [일반 병원 찾기] 버튼 클릭
    const btn = document.getElementById("myLocationBtn");
    if (btn) {
        btn.addEventListener("click", () => {
            handleSearch('hospital');
        });
    }

    // 3. [응급실 찾기] 버튼 클릭
    const erBtn = document.getElementById("emergencyBtn");
    if (erBtn) {
        erBtn.addEventListener("click", () => {
            handleSearch('emergency');
        });
    }

    // 공통 검색 핸들러
    function handleSearch(type) {
        const radius = document.getElementById("radiusSelect").value;
        const keyword = document.getElementById("keywordInput").value.trim();
        const statusMsg = document.getElementById("status-msg");
        statusMsg.style.display = "block";

        if (!navigator.geolocation) return alert("위치 정보를 사용할 수 없습니다.");

        statusMsg.innerText = "🛰️ 위치 파악 중...";
        
        navigator.geolocation.getCurrentPosition(async (position) => {
            const lat = position.coords.latitude;
            const lon = position.coords.longitude;
            statusMsg.innerText = (type === 'hospital') ? "🏥 병원 조회 중..." : "🚨 실시간 병상 조회 중...";
            
            if (map) {
                const myPos = new kakao.maps.LatLng(lat, lon);
                map.setCenter(myPos);
                
                // [수정] 응급실일 때만 지도 레벨을 7(약 10km 반경)로 변경
                // 일반 병원은 기존대로 5(약 3km 반경) 유지
                const zoomLevel = (type === 'emergency') ? 7 : 5;
                map.setLevel(zoomLevel);
                
                if (userMarker) userMarker.setMap(null);
                const userSize = new kakao.maps.Size(24, 35);
                const userImg = new kakao.maps.MarkerImage(IMG_USER, userSize); 
                userMarker = new kakao.maps.Marker({ 
                    position: myPos, map: map, title: "내 위치", image: userImg, zIndex: 3 
                });
            }

            // 타입에 따라 다른 함수 호출
            if (type === 'hospital') {
                await loadHospitals(lat, lon, keyword, radius);
            } else {
                await loadEmergency(lat, lon);
            }
            
            statusMsg.innerText = "✅ 완료!";
            
        }, (err) => {
            console.error(err);
            statusMsg.innerText = "위치 확보 실패";
        });
    }

    // 4. 일반 병원 데이터 로드
    async function loadHospitals(lat, lon, keyword, radius) {
        try {
            const url = `http://127.0.0.1:5000/api/hospitals?lat=${lat}&lon=${lon}&keyword=${keyword}&radius=${radius}`;
            const res = await fetch(url);
            const hospitals = await res.json();

            if (hospitals.length === 0) {
                alert("검색 결과가 없습니다.");
                return;
            }
            renderMarkers(hospitals);
            renderHospitalList(hospitals);
        } catch (error) {
            console.error(error);
            alert("서버 오류");
        }
    }

    // 5. 실시간 응급실 데이터 로드
    async function loadEmergency(lat, lon) {
        try {
            const url = `http://127.0.0.1:5000/api/emergency?lat=${lat}&lon=${lon}`;
            const res = await fetch(url);
            const hospitals = await res.json();

            if (hospitals.error) {
                alert("공공데이터 API 오류: " + hospitals.error);
                return;
            }
            if (hospitals.length === 0) {
                alert("반경 10km 이내에 데이터가 있는 응급실이 없습니다.");
                return;
            }

            renderEmergencyMarkers(hospitals);
            renderEmergencyList(hospitals);

        } catch (error) {
            console.error(error);
            alert("응급실 데이터 통신 실패 (API 키 확인 필요)");
        }
    }

    // 6. 일반 마커 렌더링
    function renderMarkers(hospitals) {
        removeMarkers();
        selectedMarkerIndex = -1;
        const size = new kakao.maps.Size(24, 35);
        const blueImg = new kakao.maps.MarkerImage(IMG_BLUE, size);

        hospitals.forEach((h, index) => {
            const marker = new kakao.maps.Marker({
                position: new kakao.maps.LatLng(h.lat, h.lng),
                map: map,
                title: h.name,
                image: blueImg,
                zIndex: 1
            });
            kakao.maps.event.addListener(marker, 'click', function() {
                selectHospital(index, h.lat, h.lng);
            });
            markers.push(marker);
        });
    }

    // 7. 응급실 마커 렌더링
    function renderEmergencyMarkers(hospitals) {
        removeMarkers();
        selectedMarkerIndex = -1;

        hospitals.forEach((h, index) => {
            const isAvailable = h.available > 0;
            // 병상이 있으면 초록색, 없으면 빨간색 핀
            const pinImg = isAvailable ? IMG_GREEN_PIN : IMG_GREY_PIN;
            const size = new kakao.maps.Size(32, 32);
            const markerImg = new kakao.maps.MarkerImage(pinImg, size);

            const marker = new kakao.maps.Marker({
                position: new kakao.maps.LatLng(h.lat, h.lng),
                map: map,
                title: `${h.name} (잔여: ${h.available})`,
                image: markerImg,
                zIndex: 2
            });

            // [중요] 원래 이미지 저장 (선택 해제 시 복구용)
            marker.normalImage = markerImg;

            kakao.maps.event.addListener(marker, 'click', function() {
                selectEmergency(index, h.lat, h.lng);
            });

            markers.push(marker);
        });
    }

    // 8. 일반 목록 렌더링
    function renderHospitalList(hospitals) {
        const listDiv = document.getElementById("hospital-list");
        listDiv.innerHTML = "";

        hospitals.forEach((h, index) => {
            const item = document.createElement("div");
            item.className = "hospital-item"; 
            item.id = `item-${index}`; 
            item.innerHTML = `
                <div style="font-weight:bold; font-size:1.1em; margin-bottom:5px;">${h.name}</div>
                <div style="font-size:0.9em; color:#666;">${h.address}</div>
                <div style="font-size:0.8em; color:#888; margin:5px 0;">
                    ${h.phone || "-"} | <span style="color:#d9534f; font-weight:bold;">${h.distance}km</span>
                </div>
                <button class="detail-btn" style="width:100%; margin-top:5px; background:#FAE100; color:#3b1e1e; border:none; padding:8px; border-radius:4px; font-weight:bold; cursor:pointer;">카카오맵 상세정보 ></button>
            `;
            item.onclick = (e) => {
                if (e.target.tagName === 'BUTTON') return;
                selectHospital(index, h.lat, h.lng);
            };
            item.querySelector(".detail-btn").onclick = () => {
                findAndOpenDetail(h.name, h.lat, h.lng);
            };
            listDiv.appendChild(item);
        });
    }

    // 9. 응급실 목록 렌더링
    function renderEmergencyList(hospitals) {
        const listDiv = document.getElementById("hospital-list");
        listDiv.innerHTML = ""; // 기존 목록 초기화

        hospitals.forEach((h, index) => {
            const item = document.createElement("div");
            item.className = "hospital-item";
            item.id = `er-item-${index}`;
            
            // 병상 수에 따른 색상 처리
            const statusColor = h.available > 0 ? "#2E7D32" : "#D32F2F";
            const statusText = h.available > 0 ? `🟢 가능 (${h.available}석)` : "🔴 불가 (만실)";

            item.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <div style="font-weight:bold; font-size:1.1em;">${h.name}</div>
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
            
            // 목록 클릭 시 응급실 선택 함수 호출
            item.onclick = () => {
                selectEmergency(index, h.lat, h.lng);
            };

            listDiv.appendChild(item);
        });
    }

    // 10. 병원 선택 (색상 교체) - 일반 병원용
    function selectHospital(index, lat, lng) {
        const size = new kakao.maps.Size(24, 35);
        // [수정] 선택된 마커 크기 키움 (40x55) - 약 1.6배 확대
        const selectedSize = new kakao.maps.Size(40, 55); 
        
        const blueImg = new kakao.maps.MarkerImage(IMG_BLUE, size);
        const redImg = new kakao.maps.MarkerImage(IMG_RED, selectedSize); // 선택된 이미지는 큰 사이즈 적용

        if (selectedMarkerIndex !== -1 && markers[selectedMarkerIndex]) {
            markers[selectedMarkerIndex].setImage(blueImg); 
            markers[selectedMarkerIndex].setZIndex(1);
            const prev = document.getElementById(`item-${selectedMarkerIndex}`);
            if(prev) prev.classList.remove("active");
        }
        if (markers[index]) {
            markers[index].setImage(redImg); 
            markers[index].setZIndex(2);
            map.panTo(new kakao.maps.LatLng(lat, lng));
            const curr = document.getElementById(`item-${index}`);
            if(curr) {
                curr.classList.add("active");
                curr.scrollIntoView({ behavior: "smooth", block: "center" });
            }
            selectedMarkerIndex = index;
        }
    }

    // [NEW] 응급실 선택 함수 (색상 교체 로직 추가)
    function selectEmergency(index, lat, lng) {
        // [수정] 선택된 마커 크기 키움 (40x55) - 약 1.6배 확대
        const selectedSize = new kakao.maps.Size(40, 55); 
        const selectedImg = new kakao.maps.MarkerImage(IMG_RED, selectedSize); // 선택 시 빨간 핀(크게)

        // 1. 이전에 선택된 마커가 있다면 원래 이미지(초록/빨강 점)로 복구
        if (selectedMarkerIndex !== -1 && markers[selectedMarkerIndex]) {
            markers[selectedMarkerIndex].setImage(markers[selectedMarkerIndex].normalImage);
            markers[selectedMarkerIndex].setZIndex(2);
            const prevItem = document.getElementById(`er-item-${selectedMarkerIndex}`);
            if (prevItem) prevItem.classList.remove("active");
        }

        // 2. 새로 선택된 마커를 빨간 핀으로 변경
        if (markers[index]) {
            markers[index].setImage(selectedImg);
            markers[index].setZIndex(3);
            
            map.panTo(new kakao.maps.LatLng(lat, lng));
            
            const currItem = document.getElementById(`er-item-${index}`);
            if (currItem) {
                currItem.classList.add("active");
                currItem.scrollIntoView({ behavior: "smooth", block: "center" });
            }

            selectedMarkerIndex = index;
        }
    }

    // 11. 마커 전체 삭제
    function removeMarkers() {
        for (let i = 0; i < markers.length; i++) {
            markers[i].setMap(null);
        }
        markers = [];
    }

    // 12. 상세페이지 열기
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