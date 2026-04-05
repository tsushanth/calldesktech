import CoreLocation
import Foundation

@Observable
final class LocationService: NSObject, CLLocationManagerDelegate {
    private let manager = CLLocationManager()

    private(set) var currentLocation: CLLocationCoordinate2D?
    private(set) var authorizationStatus: CLAuthorizationStatus = .notDetermined

    private var locationContinuation: CheckedContinuation<CLLocationCoordinate2D?, Never>?

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
        authorizationStatus = manager.authorizationStatus
    }

    func requestPermission() {
        manager.requestWhenInUseAuthorization()
    }

    func getCurrentLocation() async -> CLLocationCoordinate2D? {
        // Return cached location if recent
        if let currentLocation {
            return currentLocation
        }

        guard authorizationStatus == .authorizedWhenInUse || authorizationStatus == .authorizedAlways else {
            requestPermission()
            return nil
        }

        return await withCheckedContinuation { continuation in
            self.locationContinuation = continuation
            manager.requestLocation()
        }
    }

    // MARK: - CLLocationManagerDelegate

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        let coordinate = locations.first?.coordinate
        currentLocation = coordinate
        locationContinuation?.resume(returning: coordinate)
        locationContinuation = nil
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        locationContinuation?.resume(returning: nil)
        locationContinuation = nil
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        authorizationStatus = manager.authorizationStatus
    }
}
